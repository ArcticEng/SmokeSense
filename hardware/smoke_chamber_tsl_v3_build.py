import numpy as np, trimesh
from trimesh.creation import cylinder, box
from trimesh.transformations import rotation_matrix as R, translation_matrix as T, concatenate_matrices as CM
from trimesh.boolean import union, difference

# ---- PARAMETERS (mm) ----
OD=65.0; RAD=OD/2; WALL=2.5; INNER_R=RAD-WALL      # 30.0
H=45.0; FLOOR=3.0; OPT_Z=22.5                       # optical plane
LED_D=5.5                                           # 5mm LED clearance bore
IR_ANG=-18.0; BLUE_ANG=18.0                         # two LEDs, close, ~optical plane
TSL_ANG=90.0                                        # detector shifted away from LEDs
TSL_WIN=7.0                                         # square window side
FIN_T=1.8; FIN_R0=9.0; FIN_R1=INNER_R-0.8; FIN_TOP=28.0  # tall fin reaches above bores
deg=np.radians

def radial(prim, ang, z, rc):
    M=CM(R(deg(ang),[0,0,1]), T([rc,0,z]), R(np.pi/2,[0,1,0]))
    prim.apply_transform(M); return prim

def fin(ang, r0, r1, top, t=FIN_T, z0=FLOOR):
    b=box([r1-r0, t, top-z0]); 
    b.apply_transform(CM(R(deg(ang),[0,0,1]), T([(r0+r1)/2,0,(z0+top)/2])))
    return b

# body cup
body=cylinder(radius=RAD, height=H); body.apply_transform(T([0,0,H/2]))
cav =cylinder(radius=INNER_R, height=H+2); cav.apply_transform(T([0,0,FLOOR+(H+2)/2]))
m=difference([body,cav])

# add fins FIRST (union) so bores can cut through them cleanly
fins=[]
fins.append(fin(45, FIN_R0, FIN_R1, FIN_TOP))     # between LEDs(~0) and TSL(90)
fins.append(fin(-60, FIN_R0, FIN_R1, FIN_TOP))    # baffle on LED far side
fins.append(fin(150, FIN_R0, FIN_R1, FIN_TOP))    # shield around light-trap
m=union([m]+fins)

# cut LED bores + light traps + TSL window + airflow
cuts=[]
cuts.append(radial(cylinder(radius=LED_D/2,height=18), IR_ANG, OPT_Z, INNER_R-2))
cuts.append(radial(cylinder(radius=LED_D/2,height=18), BLUE_ANG, OPT_Z, INNER_R-2))
# light trap opposite LED cluster (~0deg) -> 180deg blind pocket
cuts.append(radial(cylinder(radius=4.5,height=10), 180, OPT_Z, INNER_R+1))
# TSL square window through wall
win=box([8, TSL_WIN, TSL_WIN]); win.apply_transform(CM(R(deg(TSL_ANG),[0,0,1]), T([INNER_R-1,0,OPT_Z])))
cuts.append(win)
# TSL PCB pocket (recess on outside) + 2 standoff holes
pocket=box([4, 14, 16]); pocket.apply_transform(CM(R(deg(TSL_ANG),[0,0,1]), T([RAD-1.0,0,OPT_Z])))
cuts.append(pocket)
for dz in (-9,9):
    h=radial(cylinder(radius=1.25,height=6), TSL_ANG, OPT_Z+dz, RAD-2)
    cuts.append(h)
# airflow: 2 inlets in floor + small outlet + 4 fan holes
for x in (-12,12):
    c=cylinder(radius=4,height=FLOOR+2); c.apply_transform(T([x,0,FLOOR/2])); cuts.append(c)
m=difference([m]+cuts)

m.apply_translation([32.8,32.8,0])   # match their origin
m.export("/sessions/wizardly-zealous-hypatia/mnt/outputs/chamber/DataGuard_Chamber_TSL_v3.stl")
print("watertight:",m.is_watertight,"vol cm3:",round(m.volume/1000,2),"bbox:",np.round(m.extents,1))
