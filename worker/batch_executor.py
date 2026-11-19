"""Trusted pilot execution. Only the agent communicates with Docker and the API."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import uuid

PROFILES = json.loads(Path(__file__).with_name("profiles.json").read_text())
MAX_BYTES = 2 * 1024 * 1024


def docker(*args, timeout=30):
    result = subprocess.run(["docker", *args], capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-1000:] or "Docker command failed")
    return result.stdout


def limits(device):
    flags = ["--pull=never", "--network=none", "--user=65534:65534", "--read-only",
             "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64",
             "--cpus=1", "--memory=1g", "--memory-swap=1g", "--log-driver=none",
             "--shm-size=32m", "--ulimit", "nofile=128:128",
             "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777",
             "--tmpfs", "/out:rw,noexec,nosuid,nodev,size=4m,nr_inodes=256,mode=1777"]
    if device["executionMode"] == "real_gpu":
        flags += ["--gpus", "device=" + device["deviceKey"]]
    return flags


def probe(device):
    gpu = device["executionMode"] == "real_gpu"
    profile = "pytorch-cuda" if gpu else "python-cpu"
    code = ("import torch,json; x=torch.tensor([2.,3.],device='cuda'); assert (x@x).item()==13; "
            "print(json.dumps([torch.__version__,torch.version.cuda,torch.cuda.get_device_capability()]))" if gpu else
            "import platform,json; print(json.dumps([platform.python_version(),'0',None]))")
    runtime, cuda, capability = json.loads(docker("run", "--rm", *limits(device), "--entrypoint", "python",
                                                  PROFILES[profile], "-I", "-c", code, timeout=45))
    return dict(testedImage=PROFILES[profile], runtime=runtime, cudaVersion=cuda, computeCapability=capability)


def discover(cpu):
    devices = []
    if cpu:
        devices.append(dict(deviceKey="cpu", executionMode="real_cpu_test", gpuMemory=0,
                            gpuModel="CPU development slot", driver=None))
    try:
        lines = subprocess.check_output(["nvidia-smi","--query-gpu=uuid,name,memory.total,driver_version",
                                         "--format=csv,noheader,nounits"], text=True, timeout=10)
        for line in lines.splitlines():
            key, name, mib, driver = (part.strip() for part in line.split(","))
            devices.append(dict(deviceKey=key, executionMode="real_gpu", gpuModel=name,
                                gpuMemory=int(mib)/1024, driver=driver, deviceUuid=key))
    except (OSError, subprocess.SubprocessError):
        pass
    for device in devices:
        try:
            device.update(probe(device))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            device.update(testedImage=None, cudaVersion="0", probeError=str(error)[:500])
    return devices


# Executed by the pinned interpreter. No extraction of user-controlled archives.
READ_OUTPUT = """
import os,stat,sys
fd=os.open(sys.argv[1], os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
s=os.fstat(fd)
if not stat.S_ISREG(s.st_mode) or s.st_size>2097152: sys.exit(65)
with os.fdopen(fd,'rb') as f: data=f.read(2097153)
if len(data)>2097152: sys.exit(65)
sys.stdout.buffer.write(data)
"""


class ScriptFailure(RuntimeError):
    def __init__(self, reason, code, elapsed):
        super().__init__(reason)
        self.metadata = {"exitCode": code, "elapsedMs": elapsed}


def execute_script(spec, source, device, publish):
    image = PROFILES[spec["profile"]]
    if image != spec["image"] or image != device.get("testedImage"):
        raise RuntimeError("Device runtime differs from funded profile")
    encoded = source.encode()
    if hashlib.sha256(encoded).hexdigest() != spec["scriptHash"]:
        raise RuntimeError("Downloaded script digest differs from funded specification")
    name = "bdgce-job-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory() as directory:
        script = Path(directory, "job.py")
        script.write_bytes(encoded)
        script.chmod(0o444)
        os.chmod(directory, 0o755)
        process = None
        try:
            docker("run", "-d", "--rm", "--name", name, *limits(device), "--workdir=/out",
                   "--mount", f"type=bind,src={directory},dst=/input,readonly",
                   "--entrypoint", "sleep", image, str(spec["seconds"]+90))
            started = time.monotonic()
            process = subprocess.Popen(["docker","exec",name,"timeout","-s","KILL",str(spec["seconds"]),
                                        "python","-I","-B","-u","/input/job.py",*spec["args"]],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            tail = bytearray()
            lock = threading.Lock()

            def capture():
                while chunk := process.stdout.read1(4096):
                    with lock:
                        tail.extend(chunk)
                        del tail[:-8192]

            reader = threading.Thread(target=capture, daemon=True)
            reader.start()
            previous = None
            while process.poll() is None:
                if time.monotonic()-started > spec["seconds"]+1:
                    raise ScriptFailure("Runtime limit exceeded", 124, (time.monotonic()-started)*1000)
                with lock:
                    log = tail.decode(errors="replace")
                if log and previous != log:
                    publish(log)
                    previous = log
                time.sleep(0.25)
            reader.join(timeout=2)
            elapsed = (time.monotonic()-started)*1000
            publish(tail.decode(errors="replace"))
            if process.returncode:
                timed_out = process.returncode in (124,137) and elapsed >= spec["seconds"]*1000
                raise ScriptFailure("Runtime limit exceeded" if timed_out else f"Script exited with {process.returncode}",
                                    process.returncode, elapsed)
            files = []
            total = 0
            for filename in spec["outputs"]:
                try:
                    data = docker("exec", name, "python", "-I", "-c", READ_OUTPUT, filename)
                except (RuntimeError, subprocess.SubprocessError) as error:
                    raise ScriptFailure(f"Missing or unreadable expected output: {filename}", 0, elapsed) from error
                total += len(data)
                if total > MAX_BYTES:
                    raise ScriptFailure("Expected outputs exceed 2 MiB",0,elapsed)
                files.append(dict(name=filename,sha256=hashlib.sha256(data).hexdigest(),
                                  data=base64.b64encode(data).decode()))
            return json.dumps(files,separators=(",",":")).encode(), elapsed
        finally:
            subprocess.run(["docker","rm","-f",name],capture_output=True,timeout=20)
            if process:
                process.wait(timeout=10)
                process.stdout.close()
