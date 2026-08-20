// wasm32 freestanding shim: meshoptimizer's meshopt_Allocator defaults to
// ::operator new / ::operator delete, which don't exist without a C++
// runtime. Route them to the Rust allocator (wasm_alloc.rs in this crate).
#include <stddef.h>

extern "C" void* meshopt_wasm_alloc(size_t size);
extern "C" void meshopt_wasm_free(void* ptr);

void* operator new(size_t n) { return meshopt_wasm_alloc(n); }
void* operator new[](size_t n) { return meshopt_wasm_alloc(n); }
void operator delete(void* p) noexcept { meshopt_wasm_free(p); }
void operator delete[](void* p) noexcept { meshopt_wasm_free(p); }
void operator delete(void* p, size_t) noexcept { meshopt_wasm_free(p); }
void operator delete[](void* p, size_t) noexcept { meshopt_wasm_free(p); }
