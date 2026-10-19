#!/usr/bin/env bash
# Download the IFC test models into this folder (git-ignored). They are
# third-party files, so the repo does not carry them: each comes from its public
# source, pinned to a commit so the bytes the tests were written against stay
# fixed.
#
#   ./fetch-samples.sh           the small samples the ifc-core / ifc-wasm tests
#                                and the a01 guide scene need
#   ./fetch-samples.sh --large   …plus the large real-world stress models
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

bsi="https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files"
ref_view="$bsi/80d976a9b193a26a8e928c3e79bff67af1de68a8/IFC%204.0.2.1%20(IFC%204%20ADD2%20TC1)/ISO%20Spec%20-%20ReferenceView_V1.2"
pcert="$bsi/b48ecf0f4ebf6dd4921df54e801a95403af877af/PCERT-Sample-Scene/IFC%204.0.2.1%20(IFC%204)"
pcert_old="$bsi/05585e04cecbc6b67d397284bbc54d9163027023/IFC%204.0.2.1%20(IFC%204)/PCERT-Sample-Scene"
ios="https://raw.githubusercontent.com/IfcOpenShell/files/62738f7a3cb4d251a9e0e1f3dd1f53f70659b92d"
web_ifc="https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public"

# local name | url
small=(
  "tessellation-with-individual-colors.ifc|$ref_view/tessellation-with-individual-colors.ifc"
  "column-straight-rectangle-tessellation.ifc|$ref_view/column-straight-rectangle-tessellation.ifc"
  "basin-tessellation.ifc|$ref_view/basin-tessellation.ifc"
  "wall-with-opening-and-window.ifc|$ref_view/wall-with-opening-and-window.ifc"
  "Building-Architecture.ifc|$pcert_old/Building-Architecture.ifc"
  "Building-Structural.ifc|$pcert/Building-Structural.ifc"
  "Building-Landscaping.ifc|$pcert/Building-Landscaping.ifc"
  "Infra-Bridge.ifc|$pcert/Infra-Bridge.ifc"
  "Infra-Road.ifc|$pcert/Infra-Road.ifc"
  "1019-column.ifc|$ios/1019-column.ifc"
  "great-court-roof.ifc|$ios/geometrygym_great_court_roof.ifc"
)

large=(
  "dental_clinic.ifc|$web_ifc/dental_clinic.ifc"             # ~13 MB medical/clinic building (IFC2X3)
  "FM_ARC_DigitalHub.ifc|$web_ifc/FM_ARC_DigitalHub.ifc"     # ~14 MB office / facility
  "C20-Institute-Var-2.ifc|$web_ifc/C20-Institute-Var-2.ifc" # ~11 MB institute building
  # Bigger still (uncomment if you want them):
  # "advanced_model.ifc|$web_ifc/advanced_model.ifc"         # ~34 MB
  # "schependomlaan.ifc|$web_ifc/schependomlaan.ifc"         # ~48 MB (the classic house model)
  # "ISSUE_068_ARK_NUS_skolebygg.ifc|$web_ifc/ISSUE_068_ARK_NUS_skolebygg.ifc" # ~56 MB school
)

fetch() {
  local out="${1%%|*}" url="${1#*|}"
  if [ -f "$here/$out" ]; then echo "have  $out"; return; fi
  echo "get   $out"
  curl -fL --max-time 600 -o "$here/$out" "$url" \
    && echo "  ok  $(du -h "$here/$out" | cut -f1)" \
    || { echo "  FAILED"; rm -f "$here/$out"; }
}

for m in "${small[@]}"; do fetch "$m"; done
if [ "${1:-}" = "--large" ]; then
  for m in "${large[@]}"; do fetch "$m"; done
fi
