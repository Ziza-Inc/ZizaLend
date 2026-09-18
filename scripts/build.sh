#!/bin/bash
set -e

# ZizaLend Build Script
# This script builds and optimizes the Soroban smart contracts.

# Navigate to the contracts directory
cd "$(dirname "$0")/../contracts"

echo "Building contracts..."
cargo build --target wasm32v1-none --release

echo "Contracts built successfully."

# Check if stellar/soroban CLI is available for optimization
if command -v stellar &> /dev/null; then
    echo "Optimizing contracts with stellar CLI..."
    for wasm in target/wasm32v1-none/release/*.wasm; do
        [[ "$wasm" == *.optimized.wasm ]] && continue
        out="${wasm%.wasm}.optimized.wasm"
        echo "Optimizing ${wasm} -> ${out}"
        stellar contract optimize --wasm "$wasm" --wasm-out "$out"
    done
elif command -v soroban &> /dev/null; then
    echo "Optimizing contracts with soroban CLI..."
    for wasm in target/wasm32v1-none/release/*.wasm; do
        [[ "$wasm" == *.optimized.wasm ]] && continue
        out="${wasm%.wasm}.optimized.wasm"
        echo "Optimizing ${wasm} -> ${out}"
        soroban contract optimize --wasm "$wasm" --wasm-out "$out"
    done
else
    echo "WARNING: stellar/soroban CLI not found. Skipping optimization."
    echo "Compiled WASM files are in target/wasm32v1-none/release/"
fi
