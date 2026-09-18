# GPU Compute Exchange — Smart Contracts

`GPUComputeEscrow.sol` implements the local-demo escrow lifecycle:

```
REGISTERED → FUNDED → ASSIGNED → RESULT_SUBMITTED → VERIFIED → COMPLETED
                                   └──────────────────────────→ REFUNDED
```

It stores escrowed test ETH and restricts each transition to the consumer,
operator, or assigned provider as appropriate. GPU computation remains fully
off-chain.

Run `npm test` from `blockchain/` to exercise registration, funding,
assignment, result verification, payment release, and refunds.
