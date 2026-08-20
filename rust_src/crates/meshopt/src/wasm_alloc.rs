//! Backing allocator for the wasm32 C++ shim (wasm_shim/newdelete.cpp):
//! `operator new/delete` land here. The allocation size is stashed in a
//! 16-byte prefix so `free` can rebuild the `Layout`.

use std::alloc::{alloc, dealloc, Layout};

const PREFIX: usize = 16; // keeps the returned pointer 16-byte aligned

#[no_mangle]
pub extern "C" fn meshopt_wasm_alloc(size: usize) -> *mut u8 {
    let total = size + PREFIX;
    let layout = Layout::from_size_align(total, 16).expect("meshopt alloc layout");
    unsafe {
        let base = alloc(layout);
        if base.is_null() {
            panic!("meshopt wasm allocation of {size} bytes failed");
        }
        (base as *mut usize).write(total);
        base.add(PREFIX)
    }
}

#[no_mangle]
pub extern "C" fn meshopt_wasm_free(ptr: *mut u8) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        let base = ptr.sub(PREFIX);
        let total = (base as *const usize).read();
        let layout = Layout::from_size_align(total, 16).expect("meshopt free layout");
        dealloc(base, layout);
    }
}
