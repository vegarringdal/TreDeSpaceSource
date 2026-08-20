//! Presentation styles: extract per-item colors from STYLED_ITEM chains.
//!
//! The STEP presentation model is a deep chain
//! (`STYLED_ITEM -> PRESENTATION_STYLE_ASSIGNMENT -> SURFACE_STYLE_USAGE ->
//! SURFACE_SIDE_STYLE -> SURFACE_STYLE_FILL_AREA -> FILL_AREA_STYLE ->
//! FILL_AREA_STYLE_COLOUR -> COLOUR_RGB`) with several exporter-specific
//! variations (curve styles, rendering styles, pre-defined colour names,
//! OVER_RIDING_STYLED_ITEM). Rather than enumerating every path, we walk the
//! reference graph breadth-first from each styled item until a colour is
//! found.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::step::{StepFile, P};

/// item entity id (solid, shell, face, ...) -> RGBA
pub type ColorMap = HashMap<u32, [f32; 4]>;

pub fn build_color_map(sf: &StepFile) -> ColorMap {
    let mut map = ColorMap::new();
    // plain styled items first, overriding ones second so they win
    for ty in ["STYLED_ITEM", "OVER_RIDING_STYLED_ITEM"] {
        for &si in sf.of_type(ty) {
            let p = match sf.params(si) {
                Some(p) => p,
                None => continue,
            };
            // STYLED_ITEM('name', (styles), item) and
            // OVER_RIDING_STYLED_ITEM('name', (styles), item, over_ridden):
            // the styled item is parameter 2 in both forms.
            let item = p.get(2).and_then(|v| v.as_ref_id());
            let styles: Vec<u32> = p
                .iter()
                .filter_map(|v| v.as_list())
                .flat_map(|l| l.iter().filter_map(|v| v.as_ref_id()))
                .collect();
            let (item, styles) = match (item, styles.is_empty()) {
                (Some(i), false) => (i, styles),
                _ => continue,
            };
            if let Some(rgba) = find_color(sf, &styles) {
                map.insert(item, rgba);
            }
        }
    }
    map
}

/// BFS through the style reference graph collecting the first colour
/// (`COLOUR_RGB` or a pre-defined colour name) and the first transparency
/// (`SURFACE_STYLE_TRANSPARENT`, a sibling of the fill-area style). Alpha =
/// 1 − transparency (ISO 10303-46: 0 = opaque, 1 = fully transparent). Returns
/// `None` if no colour is found (an item with only a transparency keeps the
/// default material).
fn find_color(sf: &StepFile, roots: &[u32]) -> Option<[f32; 4]> {
    let mut queue: VecDeque<(u32, usize)> = roots.iter().map(|&r| (r, 0)).collect();
    let mut seen: HashSet<u32> = roots.iter().copied().collect();
    let mut rgb: Option<[f32; 3]> = None;
    let mut transparency: Option<f32> = None;
    while let Some((id, depth)) = queue.pop_front() {
        if depth > 10 {
            continue;
        }
        match sf.entity_type(id) {
            Some("COLOUR_RGB") if rgb.is_none() => {
                if let Some(p) = sf.params(id) {
                    let nums: Vec<f64> = p.iter().filter_map(|v| v.as_f64()).collect();
                    if nums.len() >= 3 {
                        rgb = Some([nums[0] as f32, nums[1] as f32, nums[2] as f32]);
                    }
                }
            }
            Some("DRAUGHTING_PRE_DEFINED_COLOUR" | "PRE_DEFINED_COLOUR") if rgb.is_none() => {
                if let Some(c) = sf
                    .params(id)
                    .and_then(|p| p.iter().find_map(|v| v.as_str()).and_then(named_color))
                {
                    rgb = Some([c[0], c[1], c[2]]);
                }
            }
            Some("SURFACE_STYLE_TRANSPARENT") if transparency.is_none() => {
                if let Some(t) = sf
                    .params(id)
                    .and_then(|p| p.iter().find_map(|v| v.as_f64()))
                {
                    transparency = Some(t as f32);
                }
            }
            Some(_) => {
                if let Some(p) = sf.params(id) {
                    enqueue_refs(&p, depth, &mut queue, &mut seen);
                }
            }
            None => {}
        }
        if rgb.is_some() && transparency.is_some() {
            break;
        }
    }
    let rgb = rgb?;
    let alpha = transparency.map_or(1.0, |t| (1.0 - t).clamp(0.0, 1.0));
    Some([rgb[0], rgb[1], rgb[2], alpha])
}

fn enqueue_refs(
    params: &[P],
    depth: usize,
    queue: &mut VecDeque<(u32, usize)>,
    seen: &mut HashSet<u32>,
) {
    for p in params {
        match p {
            P::Ref(r) => {
                if seen.insert(*r) {
                    queue.push_back((*r, depth + 1));
                }
            }
            P::L(l) => enqueue_refs(l, depth, queue, seen),
            P::Typed(_, l) => enqueue_refs(l, depth, queue, seen),
            _ => {}
        }
    }
}

pub fn named_color(name: &str) -> Option<[f32; 4]> {
    let c = match name.to_ascii_lowercase().as_str() {
        "red" => [1.0, 0.0, 0.0, 1.0],
        "green" => [0.0, 1.0, 0.0, 1.0],
        "blue" => [0.0, 0.0, 1.0, 1.0],
        "yellow" => [1.0, 1.0, 0.0, 1.0],
        "magenta" => [1.0, 0.0, 1.0, 1.0],
        "cyan" => [0.0, 1.0, 1.0, 1.0],
        "black" => [0.0, 0.0, 0.0, 1.0],
        "white" => [1.0, 1.0, 1.0, 1.0],
        "orange" => [1.0, 0.5, 0.0, 1.0],
        "grey" | "gray" => [0.5, 0.5, 0.5, 1.0],
        _ => return None,
    };
    Some(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(src: &str) -> StepFile {
        StepFile::parse(src.as_bytes().to_vec()).expect("parse")
    }

    const STYLED: &str = "DATA;
#1=MANIFOLD_SOLID_BREP('part',#99);
#2=COLOUR_RGB('',0.9,0.1,0.2);
#3=FILL_AREA_STYLE_COLOUR('',#2);
#4=FILL_AREA_STYLE('',(#3));
#5=SURFACE_STYLE_FILL_AREA(#4);
#6=SURFACE_SIDE_STYLE('',(#5));
#7=SURFACE_STYLE_USAGE(.BOTH.,#6);
#8=PRESENTATION_STYLE_ASSIGNMENT((#7));
#9=STYLED_ITEM('color',(#8),#1);
#10=ADVANCED_FACE('f',(),#98,.T.);
#11=DRAUGHTING_PRE_DEFINED_COLOUR('green');
#12=CURVE_STYLE('',#97,POSITIVE_LENGTH_MEASURE(0.1),#11);
#13=PRESENTATION_STYLE_ASSIGNMENT((#12));
#14=OVER_RIDING_STYLED_ITEM('o',(#13),#10,#9);
ENDSEC;";

    #[test]
    fn full_surface_style_chain_resolves_to_rgb() {
        let sf = parse(STYLED);
        let map = build_color_map(&sf);
        let c = map.get(&1).expect("solid #1 colored");
        assert!((c[0] - 0.9).abs() < 1e-6 && (c[1] - 0.1).abs() < 1e-6);
    }

    #[test]
    fn overriding_item_with_named_color() {
        let sf = parse(STYLED);
        let map = build_color_map(&sf);
        let c = map.get(&10).expect("face #10 colored");
        assert_eq!(*c, [0.0, 1.0, 0.0, 1.0]); // 'green'
    }

    const TRANSPARENT: &str = "DATA;
#1=MANIFOLD_SOLID_BREP('part',#99);
#2=COLOUR_RGB('',0.2,0.4,0.6);
#3=FILL_AREA_STYLE_COLOUR('',#2);
#4=FILL_AREA_STYLE('',(#3));
#5=SURFACE_STYLE_FILL_AREA(#4);
#6=SURFACE_STYLE_TRANSPARENT(0.25);
#7=SURFACE_SIDE_STYLE('',(#5,#6));
#8=SURFACE_STYLE_USAGE(.BOTH.,#7);
#9=PRESENTATION_STYLE_ASSIGNMENT((#8));
#10=STYLED_ITEM('s',(#9),#1);
ENDSEC;";

    #[test]
    fn surface_style_transparent_sets_alpha() {
        let sf = parse(TRANSPARENT);
        let c = *build_color_map(&sf).get(&1).expect("solid #1 colored");
        assert!(
            (c[0] - 0.2).abs() < 1e-6 && (c[1] - 0.4).abs() < 1e-6 && (c[2] - 0.6).abs() < 1e-6
        );
        // alpha = 1 - 0.25
        assert!((c[3] - 0.75).abs() < 1e-6, "alpha {} (expected 0.75)", c[3]);
    }

    #[test]
    fn opaque_chain_keeps_alpha_one() {
        let sf = parse(STYLED);
        assert_eq!(build_color_map(&sf).get(&1).expect("colored")[3], 1.0);
    }

    #[test]
    fn unstyled_items_have_no_entry() {
        let sf = parse(
            "DATA;
#1=MANIFOLD_SOLID_BREP('p',#2);
ENDSEC;",
        );
        assert!(build_color_map(&sf).is_empty());
    }
}
