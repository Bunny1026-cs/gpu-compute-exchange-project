"""Small reproducible CUDA regression example for the pinned PyTorch profile."""
import json
import torch

torch.manual_seed(7)
device = torch.device("cuda")
x = torch.linspace(-1, 1, 128, device=device).reshape(-1, 1)
model = torch.nn.Linear(1, 1).to(device)
optimizer = torch.optim.SGD(model.parameters(), lr=0.1)
for epoch in range(20):
    optimizer.zero_grad()
    loss = (model(x) - (3 * x + 1)).square().mean()
    loss.backward()
    optimizer.step()
    print(f"epoch={epoch+1} loss={loss.item():.6f}", flush=True)
with open("metrics.json", "w") as stream:
    json.dump({"epochs": 20, "loss": loss.item()}, stream)
torch.save(model.state_dict(), "checkpoint.pt")
