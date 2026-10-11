#!/usr/bin/env python3
"""
Generates assets/models/main-block.glb — the HKBK Main Academic Block.

WHAT THIS IS, PLAINLY
---------------------
This is an *architectural blockout*, not a surveyed or scanned model. No
Blender was involved (none is available in this environment), so the
geometry is generated parametrically from proportions read off a walkthrough
video of the actual building (video/video/, clips IMG_0192 and IMG_0195-0202
of 39 triaged). It previously came from two campus photographs; the video
corrected several things those photos got wrong, listed below.

What it reproduces from the video:
  - the dark glass-clad tower: a COMPACT, NEAR-CUBIC mass, not a slab.
    IMG_0202 is the most orthographic frame available and gives
    width : total height ~= 0.90 - the tower is slightly taller than wide.
  - its FLAT front face. The old model canted the volume 7 degrees in plan;
    no frame supports that, so the cant is gone.
  - the single stepped parapet with a lift/stair overrun at ONE end, seen
    from opposite sides in IMG_0202 and IMG_0192 - the cross-check that
    makes it trustworthy.
  - the recessed ground-floor lobby. The glass mass OVERSAILS it; what
    reads as a canopy in photographs is the slab edge, flush with the
    facade above. There is no cantilevered canopy on this building.
  - banded granite steps up to that lobby, 5 of them (IMG_0189).
  - the fin wing: dense vertical brise-soleil that START AT THE FIRST-FLOOR
    SLAB over a plain rendered ground floor, not at grade.
  - the fin wing standing about a storey and a half SHORTER than the tower.

Storey heights are an ASSUMPTION, not a measurement: six levels are counted
on the tower and five on the fin wing from facade registers, and 3.6 m
floor-to-floor with a taller ground floor is assumed from that. See below.

What it does NOT reproduce:
  - exact dimensions. Handheld video with no reference length does not give
    absolute scale: four independent anchors in these clips (parked
    scooters, cars, a seated figure, the curtain-wall panel module)
    disagreed by more than 3x, because foreground and facade sit at very
    different depths. Proportions are close; absolute metres are scaled
    from the assumed floor-to-floor above and must not be presented as
    survey-accurate.
  - the plan angle between the two volumes. In some frames the fin wing is
    strongly foreshortened, suggesting an L wrapping the forecourt; in
    others it reads near-parallel to the tower. The angle is not
    measurable from this footage, so the two volumes are left side by side
    as before rather than encoding a guess. This is the largest remaining
    known inaccuracy.
  - the fin wing's length, cut off or tree-blocked in every frame. It keeps
    its previous photo-derived value.
  - signage, the "I love HKBK" installation, the adjacent older grey block,
    surrounding context, or any interior.
  - people. Several clips have students walking through them; they are
    scale reference only. Nothing here is reconstructed from image data -
    the output is parametric boxes, and no photogrammetry path exists in
    this file.
  - surface texture beyond the generated maps: there is no photographic
    detail, no real aggregate, no weathering matching how this building
    actually ages.

It is a large improvement on the placeholder box and a legitimate stand-in
for demonstration. It is not a substitute for a proper modelled asset, and
the README says so.

CONVENTIONS (per docs/architecture.md — the Director depends on these)
  - 1 unit = 1 metre.
  - Origin at ground level, footprint centre. Y = 0 is the ground plane.
  - glTF is Y-up; this writes Y-up directly, so no axis conversion occurs
    and nothing is pre-rotated.
  - Meshes and materials are named by function, never Cube.001.

Run:  python3 tools/make-main-block.py
"""

import os
import struct
import math
import numpy as np
from pygltflib import (
    GLTF2, Scene, Node, Mesh, Primitive, Attributes, Buffer, BufferView,
    Accessor, Material, PbrMetallicRoughness, ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER, FLOAT, UNSIGNED_INT, SCALAR, VEC3, VEC2,
    Image as GLTFImage, Sampler, Texture, TextureInfo, NormalMaterialTexture,
    OcclusionTextureInfo,
)

# ---------------------------------------------------------------- geometry

class MeshBuilder:
    """Accumulates axis-aligned (optionally yaw-rotated) boxes into one
    triangle soup with flat per-face normals."""

    def __init__(self, name, material, tile=4.0):
        self.name = name
        self.material = material
        self.tile = tile          # metres per texture repeat
        self.verts = []
        self.norms = []
        self.uvs = []
        self.idx = []

    def box(self, center, size, yaw=0.0):
        cx, cy, cz = center
        sx, sy, sz = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0)
        c, s = math.cos(yaw), math.sin(yaw)

        corners = []
        for dx in (-sx, sx):
            for dy in (-sy, sy):
                for dz in (-sz, sz):
                    x = dx * c - dz * s
                    z = dx * s + dz * c
                    corners.append((cx + x, cy + dy, cz + z))

        # index into `corners` as [x][y][z] with x major
        def C(ix, iy, iz):
            return corners[ix * 4 + iy * 2 + iz]

        faces = [
            # (four corners CCW seen from outside, normal before yaw)
            ((C(1,0,0), C(1,0,1), C(1,1,1), C(1,1,0)), ( 1, 0, 0)),  # +x
            ((C(0,0,1), C(0,0,0), C(0,1,0), C(0,1,1)), (-1, 0, 0)),  # -x
            ((C(0,1,0), C(1,1,0), C(1,1,1), C(0,1,1)), ( 0, 1, 0)),  # +y
            ((C(0,0,1), C(1,0,1), C(1,0,0), C(0,0,0)), ( 0,-1, 0)),  # -y
            ((C(0,0,1), C(0,1,1), C(1,1,1), C(1,0,1)), ( 0, 0, 1)),  # +z
            ((C(1,0,0), C(1,1,0), C(0,1,0), C(0,0,0)), ( 0, 0,-1)),  # -z
        ]

        for quad, n in faces:
            nx = n[0] * c - n[2] * s
            nz = n[0] * s + n[2] * c
            normal = (nx, n[1], nz)
            base = len(self.verts)
            # World-space planar UVs, projected on the two axes the face
            # normal is NOT dominant in. Because it is world-space rather
            # than per-face, tiling runs continuously across adjacent
            # boxes instead of restarting at every seam - a fin and the
            # wall behind it share the same grain.
            ax, ay, az = abs(normal[0]), abs(normal[1]), abs(normal[2])
            for v in quad:
                self.verts.append(v)
                self.norms.append(normal)
                if ax >= ay and ax >= az:
                    u, w = v[2], v[1]
                elif ay >= ax and ay >= az:
                    u, w = v[0], v[2]
                else:
                    u, w = v[0], v[1]
                self.uvs.append((u / self.tile, -w / self.tile))
            self.idx.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    @property
    def triangles(self):
        return len(self.idx) // 3


# ------------------------------------------------------- building geometry
#
# Dimensions in metres. FLOOR_H and the storey counts are the two that most
# affect how the Director frames the building, since every shot scales off
# the bounding box.
#
# SCALE IS DERIVED, NOT MEASURED. Storeys are counted off facade registers
# in the video - six on the tower, five on the fin wing - and everything
# else is scaled from an assumed floor-to-floor. The ground floor is taller
# than the levels above it on both volumes, which is what makes the lobby
# read as a lobby.

FLOOR_H = 3.6                        # assumed typical floor-to-floor
GROUND_H = 4.6                       # taller ground floor under the tower
FLOORS = 6                           # tower levels, ground included
WING_FLOORS = 5                      # fin wing levels, ground included
WING_GROUND_H = 4.0                  # plain rendered base, no fins on it

# The tower. Near-cubic: IMG_0202 gives width : total height ~= 0.90, and
# the returns read comparably deep, so plan is roughly square. Height comes
# from the storey assumption; width follows from the measured ratio.
GLASS_H = GROUND_H + FLOOR_H * (FLOORS - 1)   # 22.6 m to the main parapet
GLASS_W = 20.5
GLASS_D = 19.0
GLASS_YAW = 0.0                      # flat front face - the old -7 deg plan
                                     # cant is not visible in any frame
RECESS = 2.2                         # how far the ground floor is set back
                                     # behind the facade plane above it

# The fin-clad teaching wing. Length is the one dimension the video never
# resolves, so it keeps its previous photo-derived value.
WING_W, WING_D = 34.0, 14.0
WING_H = WING_GROUND_H + FLOOR_H * (WING_FLOORS - 1)   # ~1.5 storeys shorter

GAP = 0.4
GLASS_CX = -(WING_W / 2.0) - GAP     # glass volume sits west of the wing
WING_CX = GLASS_W / 2.0 + GAP

# Recentre so the origin lands at the footprint centre, per the conventions.
FOOTPRINT_MIN = GLASS_CX - GLASS_W / 2.0
FOOTPRINT_MAX = WING_CX + WING_W / 2.0
SHIFT = -(FOOTPRINT_MIN + FOOTPRINT_MAX) / 2.0
GLASS_CX += SHIFT
WING_CX += SHIFT


def build():
    # tile = metres per texture repeat. Small features (fins, steps) get a
    # tighter tile so the grain does not look blown up on a 130 mm fin.
    parts = {
        "podium":            MeshBuilder("main_block_podium", "concrete_plinth", 5.0),
        "glass":             MeshBuilder("main_block_glass_curtainwall", "glass_curtainwall", 6.0),
        "mullions":          MeshBuilder("main_block_mullions", "aluminium_mullion", 2.0),
        "wing":              MeshBuilder("main_block_fin_wing", "concrete_wall", 5.0),
        "fins":              MeshBuilder("main_block_fins", "concrete_fin", 1.6),
        "bands":             MeshBuilder("main_block_floor_bands", "concrete_band", 3.0),
        "windows":           MeshBuilder("main_block_window_bays", "window_glass", 6.0),
        "entrance":          MeshBuilder("main_block_entrance_glazing", "entrance_glazing", 6.0),
        "tower_base":        MeshBuilder("main_block_tower_base", "stone_base", 3.0),
        "fascia":            MeshBuilder("main_block_slab_fascia", "metal_fascia", 3.0),
        "steps":             MeshBuilder("main_block_steps", "stone_step", 1.8),
        "parapet":           MeshBuilder("main_block_parapet", "concrete_wall", 5.0),
        "roof_plant":        MeshBuilder("main_block_roof_plant", "concrete_wall", 5.0),
    }

    # ---- plinth the whole building sits on -----------------------------
    parts["podium"].box(
        (0.0, 0.15, 0.0),
        (FOOTPRINT_MAX - FOOTPRINT_MIN + 2.4, 0.3, max(GLASS_D, WING_D) + 2.0)
    )

    # ---- glass-clad tower ----------------------------------------------
    # The ground floor is recessed and the glazed mass OVERSAILS it, which
    # is why there is no canopy on this building - the slab edge is the
    # canopy. So the cladding runs from the head of the ground floor up to
    # the parapet, and a separate, smaller base sits underneath it.
    GLAZED_H = GLASS_H - GROUND_H
    parts["glass"].box(
        (GLASS_CX, 0.3 + GROUND_H + GLAZED_H / 2.0, 0.0),
        (GLASS_W, GLAZED_H, GLASS_D),
        GLASS_YAW
    )

    # Recessed ground floor: dark stone piers set back behind the facade
    # plane above, on the entrance side and both returns.
    parts["tower_base"].box(
        (GLASS_CX, 0.3 + GROUND_H / 2.0, -RECESS / 2.0),
        (GLASS_W - RECESS, GROUND_H, GLASS_D - RECESS)
    )

    # The slab edge at the head of the ground floor, flush with the mass
    # above. This is the element photographs read as a canopy.
    parts["fascia"].box(
        (GLASS_CX, 0.3 + GROUND_H - 0.25, GLASS_D / 2.0 - 0.06),
        (GLASS_W, 0.5, 0.16), GLASS_YAW
    )

    # Curtain-wall grid. The video shows a near-square panel module; 1.5 m
    # is the closest standard size that divides the storey height sensibly.
    # Only the faces that are actually seen are gridded - the north face
    # abuts the wing and is never in shot.
    panel_w, panel_h = 1.5, 1.5
    cols = int(GLASS_W / panel_w)
    rows = int(GLAZED_H / panel_h)
    m_t = 0.09  # mullion section

    # GLASS_YAW is 0 now, so this is an identity in z; it is kept so the
    # grid still follows the volume if a cant is ever reinstated. (Note it
    # carries no z offset of its own - correct only while the tower sits on
    # z = 0, which it does.)
    def yaw_pt(x, z):
        c, s = math.cos(GLASS_YAW), math.sin(GLASS_YAW)
        return (GLASS_CX + x * c - z * s, z * s * 0 + (x * s + z * c))

    glaze_cy = 0.3 + GROUND_H + GLAZED_H / 2.0
    for face_z, sign in ((GLASS_D / 2.0, 1), (-GLASS_D / 2.0, -1)):
        for i in range(cols + 1):
            lx = -GLASS_W / 2.0 + i * (GLASS_W / cols)
            px, pz = yaw_pt(lx, face_z + sign * 0.03)
            parts["mullions"].box((px, glaze_cy, pz),
                                  (m_t, GLAZED_H, m_t), GLASS_YAW)
        for j in range(rows + 1):
            py = 0.3 + GROUND_H + j * (GLAZED_H / rows)
            px, pz = yaw_pt(0.0, face_z + sign * 0.03)
            parts["mullions"].box((px, py, pz), (GLASS_W, m_t, m_t), GLASS_YAW)

    # East face of the tower (the one seen down the approach)
    for j in range(rows + 1):
        py = 0.3 + GROUND_H + j * (GLAZED_H / rows)
        px, pz = yaw_pt(GLASS_W / 2.0 + 0.03, 0.0)
        parts["mullions"].box((px, py, pz), (m_t, m_t, GLASS_D), GLASS_YAW)

    # Parapet, and the lift/stair overrun. The video shows ONE step, set at
    # one end of the roof and about a storey tall - not the pair of centred
    # setbacks the photographs were read as giving.
    parts["parapet"].box((GLASS_CX, 0.3 + GLASS_H + 0.5, 0.0),
                         (GLASS_W, 1.0, GLASS_D), GLASS_YAW)
    parts["parapet"].box((GLASS_CX + GLASS_W * 0.30, 0.3 + GLASS_H + 2.0, 0.0),
                         (GLASS_W * 0.36, 4.0, GLASS_D * 0.9), GLASS_YAW)

    # ---- fin-clad teaching wing ----------------------------------------
    parts["wing"].box((WING_CX, 0.3 + WING_H / 2.0, 0.0), (WING_W, WING_H, WING_D))

    # Everything on this wing is measured from the first-floor slab, which
    # is where the fin screen actually begins - the ground floor is plain
    # render with a doorway, not brise-soleil.
    FIN_BASE = 0.3 + WING_GROUND_H
    FIN_TOP = 0.3 + WING_H
    fin_levels = WING_FLOORS - 1

    # Recessed window bays behind the fins, one strip per level above ground
    for f in range(fin_levels):
        y = FIN_BASE + f * FLOOR_H + FLOOR_H * 0.55
        parts["windows"].box(
            (WING_CX, y, WING_D / 2.0 - 0.35),
            (WING_W - 2.0, FLOOR_H * 0.62, 0.12)
        )

    # Floor-slab bands between the window strips, plus the band at the head
    # of the plain ground floor that the fin screen lands on
    for f in range(fin_levels + 1):
        y = FIN_BASE + f * FLOOR_H
        parts["bands"].box((WING_CX, y, WING_D / 2.0 + 0.05),
                           (WING_W, 0.45, 0.30))

    # The fins. Dense vertical brise-soleil, the single most recognisable
    # feature of this building - but they hang off the first-floor slab and
    # stop at the parapet, they do not reach grade.
    fin_spacing = 0.92
    fin_h = FIN_TOP - FIN_BASE
    n_fins = int((WING_W - 1.0) / fin_spacing)
    fin_x0 = WING_CX - (n_fins - 1) * fin_spacing / 2.0
    for i in range(n_fins):
        x = fin_x0 + i * fin_spacing
        parts["fins"].box((x, FIN_BASE + fin_h / 2.0, WING_D / 2.0 + 0.30),
                          (0.13, fin_h - 0.3, 0.42))

    # Projecting entrance portal on the wing, with its own steps
    parts["wing"].box((WING_CX - WING_W * 0.18, 0.3 + WING_GROUND_H / 2.0 + 0.3,
                       WING_D / 2.0 + 0.6),
                      (6.0, WING_GROUND_H + 0.6, 1.4))
    for i in range(3):
        parts["steps"].box(
            (WING_CX - WING_W * 0.18, 0.30 - (i + 1) * 0.15,
             WING_D / 2.0 + 1.5 + i * 0.4),
            (5.0, 0.16, 0.42))

    # Wing parapet + rooftop plant enclosure
    parts["parapet"].box((WING_CX, 0.3 + WING_H + 0.4, 0.0), (WING_W, 0.8, WING_D))
    parts["roof_plant"].box((WING_CX + WING_W * 0.22, 0.3 + WING_H + 2.0, -WING_D * 0.15),
                            (5.0, 3.0, 4.2))

    # ---- ground-floor entrance lobby -----------------------------------
    # Set BACK behind the facade plane, under the oversailing mass. The
    # recess is what makes the entrance read; there is no canopy in front
    # of it, and nothing here projects past the tower above.
    ent_w, ent_h = 13.0, 3.6
    ent_z = GLASS_D / 2.0 - RECESS
    parts["entrance"].box((GLASS_CX + 1.0, 0.3 + ent_h / 2.0, ent_z),
                          (ent_w, ent_h, 0.14), GLASS_YAW)
    # entrance mullions
    for i in range(7):
        x = GLASS_CX + 1.0 - ent_w / 2.0 + i * (ent_w / 6.0)
        parts["mullions"].box((x, 0.3 + ent_h / 2.0, ent_z + 0.09),
                              (0.11, ent_h, 0.11), GLASS_YAW)

    # Five banded granite steps up to the lobby, inside the recess, so the
    # bounding box is still the tower's own footprint.
    for i in range(5):
        parts["steps"].box(
            (GLASS_CX + 1.0, 0.30 - (i + 1) * 0.055,
             ent_z + 0.5 + i * 0.34),
            (ent_w + 1.6, 0.11, 0.36))

    return parts


# ------------------------------------------------------------- materials
#
# PBR base values only. No maps - see the honesty note at the top of the
# file. Values are chosen so the vendored HDRI does the visual work: the
# curtain wall is near-mirror and dark, the fins and concrete are matte.

# Which generated map set each material uses. Materials absent from this
# table keep flat PBR values - the mullions and the slab fascia are thin
# metal sections never seen close enough for a map to register, and
# adding one would cost bytes for no visible gain.
TEXTURED = {
    "concrete_fin":     "concrete",
    "concrete_wall":    "concrete",
    "concrete_band":    "concrete",
    "concrete_plinth":  "concrete",
    "stone_base":       "concrete",
    "stone_step":       "concrete",
    "glass_curtainwall": "glass",
    "entrance_glazing":  "glass",
    "window_glass":      "glass",
}

# Files per set: (albedo or None, normal, ORM)
TEXTURE_SETS = {
    "concrete": ("concrete_albedo.png", "concrete_normal.png", "concrete_orm.png"),
    "glass":    (None, "glass_normal.png", "glass_orm.png"),
}

MATERIALS = {
    "glass_curtainwall": dict(base=(0.055, 0.075, 0.085, 1.0), metallic=0.85, rough=0.06),
    "aluminium_mullion": dict(base=(0.62, 0.64, 0.66, 1.0), metallic=0.90, rough=0.32),
    "concrete_fin":      dict(base=(0.86, 0.86, 0.84, 1.0), metallic=0.0, rough=0.72),
    "concrete_wall":     dict(base=(0.78, 0.77, 0.74, 1.0), metallic=0.0, rough=0.78),
    "concrete_band":     dict(base=(0.72, 0.71, 0.68, 1.0), metallic=0.0, rough=0.80),
    "concrete_plinth":   dict(base=(0.42, 0.42, 0.41, 1.0), metallic=0.0, rough=0.88),
    "window_glass":      dict(base=(0.10, 0.13, 0.16, 1.0), metallic=0.70, rough=0.14),
    "entrance_glazing":  dict(base=(0.13, 0.16, 0.18, 1.0), metallic=0.60, rough=0.09),
    # Dark polished stone piers under the oversailing mass, and the slab
    # edge above them. Both read almost black in the video.
    "stone_base":        dict(base=(0.16, 0.16, 0.17, 1.0), metallic=0.0, rough=0.55),
    "metal_fascia":      dict(base=(0.30, 0.31, 0.33, 1.0), metallic=0.75, rough=0.38),
    "stone_step":        dict(base=(0.48, 0.47, 0.45, 1.0), metallic=0.0, rough=0.82),
}


def write_glb(parts, out_path):
    gltf = GLTF2()
    gltf.scenes = [Scene(nodes=[])]
    gltf.scene = 0

    blob = bytearray()

    def push(data, target):
        offset = len(blob)
        blob.extend(data)
        while len(blob) % 4:
            blob.append(0)
        bv = len(gltf.bufferViews)
        bv_kwargs = dict(buffer=0, byteOffset=offset, byteLength=len(data))
        if target is not None:
            bv_kwargs["target"] = target
        gltf.bufferViews.append(BufferView(**bv_kwargs))
        return bv

    # ---- embed the generated maps -------------------------------------
    tex_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "assets", "textures")
    # REPEAT on both axes: UVs are world-space metres over the tile size,
    # so they run well past 1.0 and must wrap.
    gltf.samplers = [Sampler(wrapS=10497, wrapT=10497)]

    image_index = {}

    def add_image(filename):
        if filename in image_index:
            return image_index[filename]
        path = os.path.join(tex_dir, filename)
        if not os.path.exists(path):
            raise SystemExit("missing texture %s - run tools/make-materials.py first" % path)
        with open(path, "rb") as fh:
            data = fh.read()
        bv = push(data, None)
        img = len(gltf.images)
        gltf.images.append(GLTFImage(name=filename, bufferView=bv, mimeType="image/png"))
        tex = len(gltf.textures)
        gltf.textures.append(Texture(name=filename, sampler=0, source=img))
        image_index[filename] = tex
        return tex

    mat_index = {}
    for name, spec in MATERIALS.items():
        pbr = PbrMetallicRoughness(
            baseColorFactor=list(spec["base"]),
            metallicFactor=spec["metallic"],
            roughnessFactor=spec["rough"],
        )
        mat = Material(name=name, pbrMetallicRoughness=pbr, doubleSided=False)

        set_name = TEXTURED.get(name)
        if set_name:
            albedo, normal, orm = TEXTURE_SETS[set_name]
            if albedo:
                pbr.baseColorTexture = TextureInfo(index=add_image(albedo))
                # baseColorFactor multiplies the map, so flattening it to
                # white would erase the tonal difference between the dark
                # plinth, the steps and the pale fins - they would all
                # become the same mid-grey the texture happens to be.
                # Divide out the map's mean instead, so each surface keeps
                # its intended value AND gains the variation.
                MAP_MEAN = 0.80
                pbr.baseColorFactor = [
                    min(1.0, spec["base"][0] / MAP_MEAN),
                    min(1.0, spec["base"][1] / MAP_MEAN),
                    min(1.0, spec["base"][2] / MAP_MEAN),
                    1.0,
                ]
            orm_tex = add_image(orm)
            # glTF convention: R=occlusion, G=roughness, B=metalness, so
            # one image serves both slots.
            pbr.metallicRoughnessTexture = TextureInfo(index=orm_tex)
            pbr.metallicFactor = 1.0
            pbr.roughnessFactor = 1.0
            mat.occlusionTexture = OcclusionTextureInfo(index=orm_tex, strength=1.0)
            mat.normalTexture = NormalMaterialTexture(
                index=add_image(normal), scale=1.0)

        mat_index[name] = len(gltf.materials)
        gltf.materials.append(mat)

    total_tris = 0
    for key, mb in parts.items():
        if not mb.idx:
            continue
        v = np.array(mb.verts, dtype=np.float32)
        n = np.array(mb.norms, dtype=np.float32)
        uv = np.array(mb.uvs, dtype=np.float32)
        i = np.array(mb.idx, dtype=np.uint32)
        total_tris += mb.triangles

        bv_v = push(v.tobytes(), ARRAY_BUFFER)
        bv_n = push(n.tobytes(), ARRAY_BUFFER)
        bv_uv = push(uv.tobytes(), ARRAY_BUFFER)
        bv_i = push(i.tobytes(), ELEMENT_ARRAY_BUFFER)

        a_v = len(gltf.accessors)
        gltf.accessors.append(Accessor(
            bufferView=bv_v, componentType=FLOAT, count=len(v), type=VEC3,
            min=v.min(axis=0).tolist(), max=v.max(axis=0).tolist()))
        a_n = len(gltf.accessors)
        gltf.accessors.append(Accessor(
            bufferView=bv_n, componentType=FLOAT, count=len(n), type=VEC3))
        a_uv = len(gltf.accessors)
        gltf.accessors.append(Accessor(
            bufferView=bv_uv, componentType=FLOAT, count=len(uv), type=VEC2))
        a_i = len(gltf.accessors)
        gltf.accessors.append(Accessor(
            bufferView=bv_i, componentType=UNSIGNED_INT, count=len(i), type=SCALAR))

        mesh_idx = len(gltf.meshes)
        gltf.meshes.append(Mesh(name=mb.name, primitives=[Primitive(
            attributes=Attributes(POSITION=a_v, NORMAL=a_n, TEXCOORD_0=a_uv),
            indices=a_i, material=mat_index[mb.material])]))

        node_idx = len(gltf.nodes)
        gltf.nodes.append(Node(name=mb.name, mesh=mesh_idx))
        gltf.scenes[0].nodes.append(node_idx)

    gltf.buffers = [Buffer(byteLength=len(blob))]
    gltf.set_binary_blob(bytes(blob))
    gltf.save_binary(out_path)
    return total_tris


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(here, "assets", "models")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "main-block.glb")

    parts = build()

    # Final recentre. The wing's entrance portal and its steps project
    # forward of the main mass, and the lobby steps drop below grade, so
    # the raw geometry's bounding box is not centred on the origin even
    # though each volume was placed symmetrically. The Director
    # reads the bounding box, so the box is what has to be centred - and
    # the ground plane has to be exactly y=0, not y=-0.02 from the steps.
    allv = np.array([v for mb in parts.values() for v in mb.verts])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    dx = -(lo[0] + hi[0]) / 2.0
    dz = -(lo[2] + hi[2]) / 2.0
    dy = -lo[1]
    for mb in parts.values():
        mb.verts = [(v[0] + dx, v[1] + dy, v[2] + dz) for v in mb.verts]
        # UVs were computed from pre-shift world coordinates, so they have
        # to follow the geometry or the grain slides across the surface.
        shifted = []
        for k, v in enumerate(mb.verts):
            n = mb.norms[k]
            ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
            if ax >= ay and ax >= az:
                u, w = v[2], v[1]
            elif ay >= ax and ay >= az:
                u, w = v[0], v[2]
            else:
                u, w = v[0], v[1]
            shifted.append((u / mb.tile, -w / mb.tile))
        mb.uvs = shifted

    tris = write_glb(parts, out)

    allv = np.array([v for mb in parts.values() for v in mb.verts])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    size = hi - lo
    print("wrote %s" % out)
    print("  triangles : %d" % tris)
    print("  size      : %.1f MB" % (os.path.getsize(out) / 1048576.0))
    print("  bounds    : %.1f w x %.1f h x %.1f d (metres)" % (size[0], size[1], size[2]))
    print("  origin    : x %.2f, z %.2f (want ~0,0)   ground y %.2f (want 0)"
          % ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, lo[1]))
    print("  meshes    : %d, materials %d" % (len(parts), len(MATERIALS)))
