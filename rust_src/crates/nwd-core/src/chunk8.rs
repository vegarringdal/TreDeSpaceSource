//! Object-map / **spatial bounding-volume tree** parser (the chunk after the
//! fragment chunk in RVM-loader files).
//!
//! ## What it actually is (decoded)
//!
//! Despite earlier guesses that this chunk was a per-leaf *instance-count* table,
//! a full decode shows it is a **spatial BVH over the fragment stream**: a
//! 3-level tree of `(tag, count)` u32 pairs whose leaves enumerate **fragment
//! indices**, and those indices are a **permutation of `0..N`** where `N` is the
//! fragment count. It is *not* the logical-tree → geometry
//! link the §10 architecture hoped for.
//!
//! ### Grammar
//!
//! Every record is a u32 pair. The first u32 is a **tag**:
//! - `tag == 1`  → a **leaf entry**: the second u32 is a **fragment index**.
//! - `tag != 1`  → a **group header**: the second u32 is the group's **child
//!   count**, and that many records follow (recursively).
//!
//! Observed tags: `5` = an interior BVH node, `2` = a leaf-group (its children are
//! all `tag==1` fragment entries). The stream is exactly:
//!
//! ```text
//!   [5 R]                       root, R top-level partitions
//!     [5 n0] [2 m] (1 v)*m ...  partition 0: n0 leaf-groups, each m fragment ids
//!     [5 n1] ...                partition 1
//!     ...                       (R partitions total)
//! ```
//!
//! Typical layout: `R` top-level partitions (matching the distinct `idA`
//! system partitions, §5), leaf-groups, and N fragment ids forming a clean
//! permutation of `0..N`. The grouping is **assembly-coherent** (each leaf-group
//! is dominated by one owning assembly), confirming it is the spatial graph's BVH,
//! but the groups are *coarser* than the logical leaves, so the chunk cannot
//! supply a deterministic per-leaf instance count.

/// The decoded spatial BVH: the flattened fragment-index permutation (in tree
/// traversal order) plus the leaf-group partition (each inner `Vec` is one
/// leaf-group's fragment indices, in order).
#[derive(Debug, Clone, Default)]
pub struct ObjectMap {
    /// Fragment indices in BVH traversal order — a permutation of `0..frag_count`.
    pub order: Vec<u32>,
    /// One entry per leaf-group (`tag==2`): the fragment indices it owns.
    pub groups: Vec<Vec<u32>>,
    /// Number of top-level partitions (the root's child count).
    pub partitions: usize,
}

fn read_u32(buf: &[u8], o: usize) -> Option<u32> {
    buf.get(o..o + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

/// Decode a chunk as the object-map BVH. Returns `None` if the byte stream does
/// not parse as the `(tag,count)` grammar above or does not consume cleanly.
pub fn parse(chunk: &[u8]) -> Option<ObjectMap> {
    if chunk.len() < 4 || chunk.len() % 4 != 0 {
        return None;
    }
    let mut pos = 0usize;
    let mut groups: Vec<Vec<u32>> = Vec::new();
    let mut order: Vec<u32> = Vec::new();

    let root_tag = read_u32(chunk, pos)?;
    let root_n = read_u32(chunk, pos + 4)?;
    pos += 8;
    // Root must be an interior node with a small fan-out.
    if root_tag == 1 || root_n == 0 || root_n > 1024 {
        return None;
    }

    // Recursive descent, iteratively (the tree is shallow but we keep a stack so a
    // malformed chunk can't recurse unboundedly). Each stack frame = remaining
    // children of an interior node.
    let mut stack: Vec<u32> = vec![root_n];
    while let Some(rem) = stack.last_mut() {
        if *rem == 0 {
            stack.pop();
            continue;
        }
        *rem -= 1;
        let tag = read_u32(chunk, pos)?;
        let cnt = read_u32(chunk, pos + 4)?;
        pos += 8;
        if tag == 1 {
            // Leaf entry: `cnt` is a fragment index. A bare `1 v` only appears as a
            // child of a `2` group, but tolerate it anywhere.
            order.push(cnt);
            if let Some(g) = groups.last_mut() {
                g.push(cnt);
            } else {
                groups.push(vec![cnt]);
            }
        } else if tag == 2 {
            // Leaf-group: `cnt` children, all `1 v` entries (8 bytes each) —
            // reserve no more than the rest of the chunk can hold.
            let fit = chunk.len().saturating_sub(pos) / 8;
            groups.push(Vec::with_capacity((cnt as usize).min(fit)));
            stack.push(cnt);
        } else {
            // Interior node: `cnt` children (groups or sub-nodes).
            if cnt > 1024 {
                return None;
            }
            stack.push(cnt);
        }
    }

    if pos != chunk.len() {
        return None; // must consume the whole chunk to be the object-map
    }
    Some(ObjectMap {
        order,
        groups,
        partitions: root_n as usize,
    })
}

/// Locate and decode the object-map among a container's chunks: the chunk that
/// parses as the BVH grammar **and** whose fragment-index leaves are a permutation
/// of `0..frag_count`. `frag_count` lets the caller disambiguate from any other
/// chunk that happens to parse (none do in practice).
pub fn find(container: &crate::Container, frag_count: usize) -> Option<ObjectMap> {
    for i in 0..container.chunks.len() {
        if let Some(om) = parse(&container.data(i)) {
            if om.order.len() == frag_count && is_permutation(&om.order, frag_count) {
                return Some(om);
            }
        }
    }
    None
}

fn is_permutation(v: &[u32], n: usize) -> bool {
    if v.len() != n {
        return false;
    }
    let mut seen = vec![false; n];
    for &x in v {
        let i = x as usize;
        if i >= n || seen[i] {
            return false;
        }
        seen[i] = true;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inspect::{classify_all, ChunkKind};

    /// Decode a real chunk-8 object-map from the Huldra sample
    /// (`convertSamples/nwd/huldra/`) and lock its layout: 2 top-level
    /// partitions, 80 leaf-groups, a clean permutation of 0..852.
    #[test]
    fn object_map_layout() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../convertSamples/nwd/huldra/HDA-ASB-CD2.nwd"
        );
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let container = crate::parse(&bytes).expect("parse");

        // Count fragments the same way the converter does.
        let frag_count = (0..container.chunks.len())
            .map(|ci| {
                let data = container.data(ci);
                let mut f = crate::fragments::placements(&data);
                let seen: std::collections::HashSet<usize> = f.iter().map(|x| x.offset).collect();
                for fr in crate::fragments::parse(&data).unwrap_or_default() {
                    if !seen.contains(&fr.offset) {
                        f.push(fr);
                    }
                }
                f.len()
            })
            .max()
            .unwrap_or(0);
        assert_eq!(frag_count, 852, "expected 852 fragments");

        let om = find(&container, frag_count).expect("object-map chunk");
        assert_eq!(om.partitions, 2, "2 top-level system partitions");
        assert_eq!(om.groups.len(), 80, "80 leaf-groups");
        assert_eq!(om.order.len(), 852, "852 fragment ids");
        assert!(
            is_permutation(&om.order, 852),
            "ids are a permutation of 0..852"
        );
        // Sanity: the classifier still finds the other streams.
        let infos = classify_all(&container);
        assert!(infos.iter().any(|i| i.kind == ChunkKind::LogicalHierarchy));
    }
}
