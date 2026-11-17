//! C ABI for step2glb — convert STEP bytes to GLB bytes from any language that
//! can call C (Python `ctypes`, C/C++, etc.).
//!
//! ```c
//! uint8_t *glb = NULL; size_t glb_len = 0;
//! int rc = step2glb_convert(step_ptr, step_len, &glb, &glb_len);
//! if (rc == 0) { /* use glb[0..glb_len] */ step2glb_free(glb, glb_len); }
//! ```

use std::os::raw::c_int;

use step_core::convert::{convert, ConvertOptions};
use step_core::io::{MemSink, MemTemp};

/// Convert a STEP buffer to a GLB buffer.
///
/// On success returns 0 and writes a heap buffer to `*out_ptr` / `*out_len`,
/// which the caller must release with [`step2glb_free`]. Returns non-zero on
/// bad arguments (1) or conversion failure (2).
///
/// # Safety
/// `step_ptr` must point to `step_len` readable bytes; `out_ptr` and `out_len`
/// must be valid, writable pointers.
#[no_mangle]
pub unsafe extern "C" fn step2glb_convert(
    step_ptr: *const u8,
    step_len: usize,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> c_int {
    if step_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
        return 1;
    }
    let input = std::slice::from_raw_parts(step_ptr, step_len).to_vec();
    let mut sink = MemSink::default();
    let mut tmp = MemTemp::default();
    match convert(
        Box::new(input),
        &mut sink,
        &mut tmp,
        &ConvertOptions::default(),
    ) {
        Ok(_) => {
            let mut boxed = sink.0.into_boxed_slice();
            *out_len = boxed.len();
            *out_ptr = boxed.as_mut_ptr();
            std::mem::forget(boxed); // ownership passes to the caller
            0
        }
        Err(_) => 2,
    }
}

/// Free a buffer returned by [`step2glb_convert`].
///
/// # Safety
/// `ptr`/`len` must be exactly what a `step2glb_convert` call returned, used
/// once.
#[no_mangle]
pub unsafe extern "C" fn step2glb_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c_abi_convert_round_trip() {
        let step = include_bytes!("../../step-core/tests/fixtures/csg_block_minus_cylinder.step");
        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;
        let rc = unsafe { step2glb_convert(step.as_ptr(), step.len(), &mut out_ptr, &mut out_len) };
        assert_eq!(rc, 0, "conversion succeeds");
        assert!(out_len > 12, "non-trivial GLB");
        let glb = unsafe { std::slice::from_raw_parts(out_ptr, out_len) };
        assert_eq!(&glb[0..4], b"glTF", "valid GLB magic");
        unsafe { step2glb_free(out_ptr, out_len) };
    }

    #[test]
    fn c_abi_rejects_null() {
        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;
        // a null input pointer must be rejected (return code 1), not deref'd
        let rc = unsafe { step2glb_convert(std::ptr::null(), 0, &mut out_ptr, &mut out_len) };
        assert_eq!(rc, 1);
    }
}
