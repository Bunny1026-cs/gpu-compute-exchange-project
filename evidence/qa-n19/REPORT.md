# BDGCE same-laptop end-to-end QA · November 19, 2026

**CPU pilot passed.** Two independent Chromium contexts used throwaway consumer and provider accounts on one Windows laptop. A third throwaway consumer exercised access controls through the API. All 11 terminal jobs matched the live Hardhat contract and MongoDB. Seven paid once and four refunded once. All terminal reservations were released.

## Scenario results

| Scenario | Result | Evidence and observation |
| --- | --- | --- |
| Pair and enable | PASS · browser + real agent | Provider issued a code in its browser profile. The paired worker detected Python 3.12.10 in the digest-pinned container. The provider enabled the slot at 12,345 wei/min. [Setup screenshot](01-provider-setup.png) |
| Submit and track | PASS · browser | Consumer uploaded a deterministic Python file and funded a 45-second reservation for 12,345 wei. Both dashboards displayed job `6afecd7a59488c00cbe109b6`. [Submission](02-consumer-submission.png) · [consumer progress](03-consumer-progress.png) · [provider progress](04-provider-progress.png) |
| Download, verify and accept | PASS · browser + live escrow | Consumer downloaded both files. SHA-256 matched for each file, the stored bundle and the provider-signed on-chain result. Before acceptance escrow was in ResultSubmitted with zero PaymentReleased events. After acceptance it paid the provider wallet `0x6fa04142CB390d3FA261075Fe31F3BF503a00Ef5` exactly 12,345 wei. [Results](05-consumer-results.png) · [consumer receipt](06-consumer-payment.png) · [provider receipt](07-provider-payment.png) |
| Paste and Run again | PASS · browser | Pasted script returned the exact text `paste-ok` and was paid. Run again produced `6afecd9a59488c00cbe109db` with identical frozen spec, a new quote and no inherited receipts. [Browser checks](checks.json) |
| No worker online | PASS · live API | During the real outage, the paired slot reported offline. The consumer saved `6afece2a59488c00cbe10abd` as DRAFT with zero receipts. [Record](offline-draft.json) |
| Two funded jobs and one slot | PASS · live API + real agent | Recorded QUEUED, ASSIGNED, RUNNING and REVIEW for two funded jobs. The second waited through execution of the first. Both paid. [State samples](checks.json) |
| Pause during execution | PASS · browser + live API | The active uploaded job finished after the provider paused its device. In a second run a previously funded waiter remained QUEUED, without an assignment receipt, across seven seconds after the first reached REVIEW. Resuming enabled the second job to run and settle. [Both jobs](drain.json) |
| Syntax error, missing output and timeout | PASS · live API + browser + chain | SyntaxError appeared in the worker log, exit 1. The missing-file case named `result.txt` despite interpreter exit 0. A two-second timeout reported a runtime-limit failure. Each dashboard showed the reason, each job refunded, and each slot released. [Timeout screenshot](08-timeout-refund.png) · [failure details](checks.json) |
| Disconnect and stale worker | PASS · induced link outage, real lease and chain | The QA relay interrupted the running agent's API link for 80.021 s. The backend recorded “Worker lease expired”, issued one refund, and released the slot. A result upload using the expired lease received HTTP 409. The same agent served jobs after reconnection. [Disconnect evidence](disconnect-end.json) |
| Invalid upload | PASS · browser + live API | Browser rejected a 49,153-byte Python file. API rejected empty and oversized source with HTTP 400 before job creation. [Checks](checks.json) |
| Cross-account access | PASS · live API | The third signed-in consumer received HTTP 403 on both the job detail and the named artifact endpoint. [Checks](checks.json) |
| Pairing reuse and expiry | PASS · browser + live API | Replay of the consumed code returned HTTP 403. A separate unused code returned HTTP 403 after its actual five-minute expiry. [Checks with timestamps](checks.json) |
| Retry upload, acceptance, settlement and refund | PASS · live API + chain | Replayed identical uploaded bytes gave HTTP 200 and the same digest. Repeated acceptance, reconciliation and refund requests produced one terminal event per job. [Upload replay](upload-retry.json) · [chain audit](ledger.json) |
| Existing matrix workload | PASS · native CPU worker + live API | 64×64 matrix job settled automatically. All 4,096 downloaded values matched the independent float64 reference. Maximum absolute error was 0.0000033712. [Application verification](matrix.json) · [independent comparison](independent-matrix.json) |
| Local regression suites and frontend | PASS · automated | [95 backend](backend.txt), [37 contract](blockchain.txt), [27 worker](worker.txt). [Production build](build.txt) and [lint](lint.txt) exited 0. Worker suite includes fixture-based GPU discovery and a synthetic device-lock test. |
| Physical CUDA | BLOCKED · hardware | Agent detected only the CPU slot. Host PyTorch reported zero CUDA devices and `nvidia-smi` was unavailable. No physical CUDA execution or GPU timings recorded. [Agent inventory](inventory.json) · [host inventory](host-inventory.json) |

## Downloaded outputs

The uploaded script printed `QA_TOTAL=12`, exited 0 on device `cpu`, and recorded **12,579.75 ms** elapsed in Python 3.12.10, including a deliberate 12-second sleep. Bundle SHA-256 was `0aeec41691a0ba81367061cbd786b11e0bcb56367091445a17ed24d913878204`. [Source hash, runtime metadata, exact expected/actual strings, file hashes and receipts](successful-job.json)

| Browser download | Expected bytes as text | Actual |
| --- | --- | --- |
| [metrics.json](metrics.json) | `{"count":3,"sum":12}` | Exact match, no trailing newline |
| [rows.csv](rows.csv) | Four LF-terminated lines: `value,square`, `2,4`, `4,16`, `6,36` | Exact match, including final LF |

## Payment and refund ledger

Each row was independently read from MongoDB and the live contract. The audit checked successful receipts, transaction senders, escrow amounts, duplicate terminal events and device release. [Full audit including funding, assignment and provider signatures](ledger.json)

| Job ID | Status | Local test wei | Terminal transaction |
| --- | --- | ---: | --- |
| `6afecd7a59488c00cbe109b6` | COMPLETED | 12345 | `0x8a4f44ba6838eeedcf414dae205f667139f0832eb22aa63840a33019870eb148` |
| `6afecd9a59488c00cbe109dd` | COMPLETED | 12345 | `0x076fad43cee50acb30c0bf378226d3a8d6498d5ad17ad4a8503474054cae5256` |
| `6afecdcb59488c00cbe10a1e` | COMPLETED | 12345 | `0xd9ad887413efdadb86515e870cca8d1bfa570f849376ed79203826c439c83ea2` |
| `6afecdcb59488c00cbe10a1f` | COMPLETED | 12345 | `0xa73bc8cf1c536743e8ddad7290badaec501884b4d60918dd5cb62d1265868781` |
| `6afece1959488c00cbe10a98` | COMPLETED | 1000000000000000 | `0x76cdcdfd21bec1f0637ffb2a18731e7134dba72b1bf9aa0984f54459757e87ff` |
| `6afece5459488c00cbe10b00` | COMPLETED | 12345 | `0x39285634fa8c3ae5beb9ece41ee299143a182bee8059da6e04b4eb5cadd8cdd7` |
| `6afece5459488c00cbe10b01` | COMPLETED | 12345 | `0x5d93bb739b29c453ef60060e354bccb037ba456286ce6e617aa08da6ad294fec` |
| `6afecda859488c00cbe109ef` | REFUNDED | 12345 | `0x1f02547632600f28c871aea0e339dd13eb1c6404f4da9eef10cfcf0c9f598327` |
| `6afecdb259488c00cbe109fc` | REFUNDED | 12345 | `0x36858864c0e9fd80be9a21f6e87db936550698f682be4558e3e2f9364b19ce8d` |
| `6afecdbc59488c00cbe10a0b` | REFUNDED | 12345 | `0x0b297fa4576b33fec2763a11c2db8737f7b67ffb9ffe70eb71bd5bf212c2be69` |
| `6afecdec59488c00cbe10a4b` | REFUNDED | 12345 | `0xed8720bb1d02b40fc53849ae0092cbc2043d92cccfe71ab8819310deb58bbbdf` |

[Startup and test commands](COMMANDS.md) · [QA harness](harness/)
