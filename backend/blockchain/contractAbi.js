/**
 * blockchain/contractAbi.js
 * GPU Compute Exchange — GPUComputeEscrow ABI
 *
 * Extracted from the Hardhat compilation artifact.
 * Re-generate from: blockchain/artifacts/contracts/GPUComputeEscrow.sol/GPUComputeEscrow.json
 *
 * IMPORTANT: Keep in sync with the deployed contract.
 * If GPUComputeEscrow.sol changes, recompile and update this ABI.
 */

"use strict";

const ESCROW_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "_operator", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "AlreadyRefunded",     "type": "error" },
  { "inputs": [], "name": "AlreadyReleased",      "type": "error" },
  { "inputs": [], "name": "InvalidAddress",       "type": "error" },
  { "inputs": [], "name": "InvalidAmount",        "type": "error" },
  { "inputs": [], "name": "InvalidResultHash",    "type": "error" },
  { "inputs": [], "name": "InvalidProvider",      "type": "error" },
  { "inputs": [
      { "internalType": "enum GPUComputeEscrow.JobStatus", "name": "current",  "type": "uint8" },
      { "internalType": "enum GPUComputeEscrow.JobStatus", "name": "expected", "type": "uint8" }
    ], "name": "InvalidStatus", "type": "error" },
  { "inputs": [], "name": "JobAlreadyExists",     "type": "error" },
  { "inputs": [], "name": "JobDoesNotExist",      "type": "error" },
  { "inputs": [], "name": "ProviderAlreadyAssigned", "type": "error" },
  { "inputs": [], "name": "Reentrancy",           "type": "error" },
  { "inputs": [], "name": "ResultHashMismatch",   "type": "error" },
  { "inputs": [], "name": "TransferFailed",       "type": "error" },
  { "inputs": [], "name": "Unauthorized",         "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "consumer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount",   "type": "uint256" }
    ],
    "name": "FundsDeposited", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "provider", "type": "address" }
    ],
    "name": "JobAssigned", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "consumer", "type": "address" }
    ],
    "name": "JobRegistered", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "previousOperator", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOperator",       "type": "address" }
    ],
    "name": "OperatorChanged", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "provider", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount",   "type": "uint256" }
    ],
    "name": "PaymentReleased", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "consumer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount",   "type": "uint256" }
    ],
    "name": "RefundIssued", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",       "type": "bytes32" },
      { "indexed": true,  "internalType": "address", "name": "provider",    "type": "address" },
      { "indexed": false, "internalType": "bytes32", "name": "resultHash",  "type": "bytes32" }
    ],
    "name": "ResultSubmitted", "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "bytes32", "name": "jobId",      "type": "bytes32" },
      { "indexed": false, "internalType": "bytes32", "name": "resultHash", "type": "bytes32" }
    ],
    "name": "ResultVerified", "type": "event"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "jobId",    "type": "bytes32" },
      { "internalType": "address", "name": "provider", "type": "address" }
    ],
    "name": "assignJob",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "jobId", "type": "bytes32" }],
    "name": "depositFunds",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEscrowBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "jobId", "type": "bytes32" }],
    "name": "getJob",
    "outputs": [{
      "components": [
        { "internalType": "bytes32",                          "name": "jobId",          "type": "bytes32" },
        { "internalType": "address",                          "name": "consumer",       "type": "address" },
        { "internalType": "address",                          "name": "provider",       "type": "address" },
        { "internalType": "uint256",                          "name": "payment",        "type": "uint256" },
        { "internalType": "bytes32",                          "name": "resultHash",     "type": "bytes32" },
        { "internalType": "enum GPUComputeEscrow.JobStatus", "name": "status",         "type": "uint8"   },
        { "internalType": "bool",                             "name": "paymentReleased","type": "bool"    }
      ],
      "internalType": "struct GPUComputeEscrow.Job",
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "operator",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "jobId", "type": "bytes32" }],
    "name": "refund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "jobId", "type": "bytes32" }],
    "name": "registerJob",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes32", "name": "jobId", "type": "bytes32" }],
    "name": "releasePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "newOperator", "type": "address" }],
    "name": "setOperator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "jobId",      "type": "bytes32" },
      { "internalType": "bytes32", "name": "resultHash", "type": "bytes32" }
    ],
    "name": "submitResult",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "jobId",              "type": "bytes32" },
      { "internalType": "bytes32", "name": "expectedResultHash", "type": "bytes32" }
    ],
    "name": "verifyResult",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Human-readable status labels matching the Solidity enum
const BLOCKCHAIN_JOB_STATUS = Object.freeze({
  0: "NONE",
  1: "REGISTERED",
  2: "FUNDED",
  3: "ASSIGNED",
  4: "RESULT_SUBMITTED",
  5: "VERIFIED",
  6: "COMPLETED",
  7: "REFUNDED",
});

module.exports = { ESCROW_ABI, BLOCKCHAIN_JOB_STATUS };
