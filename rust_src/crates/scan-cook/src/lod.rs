//! In-memory octree build with additive LOD (Potree-2 style, no duplicates):
//! subdivide until a node holds ≤ `capacity` points, then bottom-up each
//! inner node takes a representative subsample of its children's points —
//! chosen by `meshopt_simplifyPoints` (position + colour aware) — and the
//! children keep the rest.

use crate::mo;

use crate::node::{Cube, Grid, NodeKey, Pt};

pub struct Tree {
    pub key: NodeKey,
    pub cube: Cube,
    pub pts: Vec<Pt>,
    pub children: Vec<Tree>,
}

#[derive(Clone, Copy, Debug)]
pub struct LodParams {
    pub capacity: usize,
    /// Do not subdivide cubes at or below this size (grid units).
    pub min_size: i64,
    pub color_weight: f32,
    pub use_color: bool,
}

/// Build the subtree of `cube` from its points.
pub fn build(key: NodeKey, cube: Cube, pts: Vec<Pt>, grid: &Grid, p: &LodParams) -> Tree {
    if pts.len() <= p.capacity || cube.size <= p.min_size {
        return Tree {
            key,
            cube,
            pts,
            children: Vec::new(),
        };
    }
    let mut count = [0usize; 8];
    for q in &pts {
        count[cube.octant_of(q.g)] += 1;
    }
    let mut buckets: [Vec<Pt>; 8] = Default::default();
    for (b, &c) in buckets.iter_mut().zip(&count) {
        b.reserve_exact(c);
    }
    for q in pts {
        buckets[cube.octant_of(q.g)].push(q);
    }
    let children = buckets
        .into_iter()
        .enumerate()
        .filter(|(_, b)| !b.is_empty())
        .map(|(o, b)| build(key.child(o), cube.child(o), b, grid, p))
        .collect();
    let mut t = Tree {
        key,
        cube,
        pts: Vec::new(),
        children,
    };
    select_up(&mut t, grid, p);
    t
}

/// Move a subsample of the children's own points into `t`. The parent aims
/// at twice the children's spacing (¼ of their points on a surface), capped
/// at `capacity`.
pub fn select_up(t: &mut Tree, grid: &Grid, p: &LodParams) {
    let total: usize = t.children.iter().map(|c| c.pts.len()).sum();
    if total == 0 {
        return;
    }
    let target = (total / 4).clamp(1, p.capacity);
    let s = grid.scale;
    let mut pos = Vec::with_capacity(total);
    let mut col = if p.use_color {
        Vec::with_capacity(total)
    } else {
        Vec::new()
    };
    for c in &t.children {
        for q in &c.pts {
            pos.push([
                ((q.g[0] as i64 - t.cube.min[0]) as f64 * s) as f32,
                ((q.g[1] as i64 - t.cube.min[1]) as f64 * s) as f32,
                ((q.g[2] as i64 - t.cube.min[2]) as f64 * s) as f32,
            ]);
            if p.use_color {
                col.push([
                    q.rgb[0] as f32 / 255.0,
                    q.rgb[1] as f32 / 255.0,
                    q.rgb[2] as f32 / 255.0,
                ]);
            }
        }
    }
    let sel = mo::simplify_points(
        &pos,
        p.use_color.then_some(col.as_slice()),
        p.color_weight,
        target,
    );
    let mut take = vec![false; total];
    for i in sel {
        take[i as usize] = true;
    }
    let mut base = 0;
    t.pts.reserve(target);
    for c in &mut t.children {
        let n = c.pts.len();
        let flags = &take[base..base + n];
        let mut keep = Vec::with_capacity(n);
        for (q, &f) in c.pts.drain(..).zip(flags) {
            if f {
                t.pts.push(q);
            } else {
                keep.push(q);
            }
        }
        c.pts = keep;
        base += n;
    }
}

/// Visit every node (pre-order).
pub fn walk<'a>(t: &'a Tree, f: &mut impl FnMut(&'a Tree)) {
    f(t);
    for c in &t.children {
        walk(c, f);
    }
}
