/*
 * DataGuard v2 — Dual-Wavelength Optical Smoke Chamber
 * Arctic Engineering — 2026
 * 
 * 3D-printable in matte black PLA or PETG
 * Two-piece snap-fit design (base + lid)
 * 
 * Print: Black PLA/PETG, 0.2mm layers, 20% infill, supports on
 * Render: Open in OpenSCAD (free), F6 to render, export STL
 * Download OpenSCAD: https://openscad.org
 *
 * Dimensions: 65mm diameter x 45mm tall
 * Components: IR LED 940nm, Blue LED 470nm, 2x BPW34 photodiodes
 * Angles: Forward PD at 25°, Backward PD at 135° from beam axis
 */

chamber_od=65; chamber_h=45; wall_thick=2.5; base_thick=3; lid_thick=3;
sample_d=20; led_bore_d=5.5; pd_bore_d=4.5; bore_depth=8;
fwd_angle=25; bck_angle=135;
inlet_d=8; outlet_d=8; fan_mount_d=25; fan_hole_d=3;
baffle_thick=1.5; baffle_h=12; baffle_gap=3;
snap_d=2; snap_count=4;
pcb_standoff_h=5; pcb_standoff_d=6; pcb_screw_d=2.5; pcb_mount_spacing=50;
$fn=60;

chamber_r=chamber_od/2; inner_r=chamber_r-wall_thick;
sample_r=sample_d/2; mid_h=chamber_h/2; led_z=mid_h;

module base(){
  difference(){
    union(){
      cylinder(d=chamber_od,h=mid_h);
      translate([0,0,mid_h]) cylinder(d=chamber_od-wall_thick,h=2);
    }
    translate([0,0,base_thick]) cylinder(d=chamber_od-wall_thick*2,h=mid_h+5);
    // IR LED bore 0deg
    translate([0,0,led_z]) rotate([0,90,0]) translate([0,0,inner_r-bore_depth]) cylinder(d=led_bore_d,h=bore_depth+wall_thick+1);
    // Blue LED bore 180deg
    translate([0,0,led_z-5]) rotate([0,90,180]) translate([0,0,inner_r-bore_depth]) cylinder(d=led_bore_d,h=bore_depth+wall_thick+1);
    // Forward PD bore
    translate([0,0,led_z]) rotate([0,90,fwd_angle]) translate([0,0,inner_r-bore_depth]) cylinder(d=pd_bore_d,h=bore_depth+wall_thick+1);
    // Backward PD bore
    translate([0,0,led_z]) rotate([0,90,bck_angle]) translate([0,0,inner_r-bore_depth]) cylinder(d=pd_bore_d,h=bore_depth+wall_thick+1);
    // Light trap
    translate([0,0,led_z]) rotate([0,90,180]) translate([0,0,inner_r-3]) cylinder(d=8,h=10);
    // Air outlet + fan holes
    cylinder(d=outlet_d,h=base_thick+1);
    for(a=[45,135,225,315]) rotate([0,0,a]) translate([fan_mount_d/2,0,0]) cylinder(d=fan_hole_d,h=base_thick+1);
    // Wire channel
    translate([chamber_r-wall_thick-1,-3,base_thick]) cube([wall_thick+2,6,mid_h]);
  }
  // Baffles
  for(ba=[fwd_angle/2,(bck_angle)/2,180+fwd_angle/2])
    translate([0,0,base_thick]) rotate([0,0,ba]) translate([sample_r+2,-baffle_thick/2,0]) cube([inner_r-sample_r-baffle_gap-2,baffle_thick,baffle_h]);
  // Light trap fins
  translate([0,0,led_z-4]) rotate([0,0,180]) translate([inner_r-6,-4,0]) for(i=[0:3]) translate([0,i*2,0]) cube([5,1,8]);
  // PCB standoffs
  for(a=[45,135,225,315]) rotate([0,0,a]) translate([pcb_mount_spacing/2,0,0]) difference(){cylinder(d=pcb_standoff_d,h=pcb_standoff_h);cylinder(d=pcb_screw_d,h=pcb_standoff_h+1);}
  // Snap bumps
  for(a=[0:360/snap_count:359]) rotate([0,0,a]) translate([chamber_r-wall_thick-snap_d/2,0,mid_h+1]) sphere(d=snap_d);
}

module lid(){
  difference(){
    cylinder(d=chamber_od,h=mid_h);
    translate([0,0,-1]) cylinder(d=chamber_od-wall_thick*2,h=mid_h-lid_thick+1);
    translate([0,0,-1]) cylinder(d=chamber_od-wall_thick+0.3,h=3);
    translate([10,0,mid_h-lid_thick-1]) cylinder(d=inlet_d,h=lid_thick+2);
    translate([-10,0,mid_h-lid_thick-1]) cylinder(d=inlet_d,h=lid_thick+2);
    for(a=[0:360/snap_count:359]) rotate([0,0,a]) translate([chamber_r-wall_thick-snap_d/2,0,1]) sphere(d=snap_d+0.4);
  }
  for(a=[0,90]) rotate([0,0,a]) translate([-0.5,-inlet_d/2-2,mid_h-lid_thick]) cube([1,inlet_d+4,lid_thick]);
}

// Assembly view
color("DimGray") base();
color("DimGray",0.5) translate([0,0,mid_h]) lid();

// For STL export uncomment ONE:
// base();
// translate([0,0,mid_h]) lid();
