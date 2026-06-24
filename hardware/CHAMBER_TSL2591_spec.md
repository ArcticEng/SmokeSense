# DataGuard Optical Chamber — TSL2591 revision (dimensioned change-list)

Apply these to your existing 65 mm × 45 mm base in SolidWorks/Fusion. All
coordinates: chamber axis = origin, **optical plane z = 22.5 mm** (chamber
mid-height). Angles measured about the vertical axis, 0° = +X.

A verified print-ready mesh of this design ships alongside as
`DataGuard_Chamber_TSL_v3.stl` (and the parametric build script
`smoke_chamber_tsl_v3_build.py`).

## 1. Detector — replace round bore with a square TSL2591 window
| Feature | Old | New |
|---|---|---|
| Aperture shape | Ø4.5 round (BPW34) | **7 × 7 mm square** through-window |
| Height (centre) | z = 22.5 | z = 22.5 (unchanged) |
| Angular position | 25° | **90°** (shifted away from the LED cluster) |
| PCB seat | none | **flat recess ~14 (tall) × 16 (wide) × 3 mm deep** on the OUTER face, centred on the window |
| Mounting | none | **2 × Ø2.5 mm** standoff holes, vertical spacing 18 mm (±9 from centre), 5–6 mm deep — adjust to your TSL2591 board's hole pitch |

The window is the only opening the TSL sees; the PCB sits in the outer recess
looking in through it.

## 2. LEDs — put BOTH on the optical plane, clustered
| LED | Bore | Height | Angle |
|---|---|---|---|
| IR 850 nm | Ø5.5 | **z = 22.5** | **−18°** |
| Blue 470 nm | Ø5.5 | **z = 22.5** (was 17.5 — raise 5 mm) | **+18°** |

Both radial, pointing at the central sample volume. Raising the blue LED to
the plane makes both wavelengths illuminate the *same* volume the TSL views —
essential for the IR/blue particle-size ratio.

## 3. Baffle / fin between LEDs and detector — taller + closer to wall
| Param | Old | New |
|---|---|---|
| Top height | ~z 15 | **z = 28** (above the bore tops at ~25.3) |
| Base | z 3 | z 3 |
| Thickness | 1.5 | 1.8 mm |
| Radial span | r 12 → 25 | **r 9 → 29.2** (leave ~0.8 mm to wall for airflow) |
| Position | 12.5° | **45°** — directly on the LED→TSL line of sight |

Add two more of the same fin at **−60°** and **150°** to box in the scatter
volume and shield the light trap. The whole point: the TSL must never see an
LED directly — only scattered light.

## 4. Light trap — opposite the LED cluster
Ø4.5 mm blind pocket, ~8 mm deep, at **180°**, z = 22.5 — absorbs the IR/blue
through-beam so it can't backscatter off the far wall into the detector.

## 5. Remove the dead detector bore
The old design had a second photodiode bore at 135°. You have **one** TSL —
delete/cap it. The IR-vs-blue ratio comes from time-multiplexing the two LEDs
into the single TSL (the firmware already does this), not a second detector.

## 6. Airflow (unchanged intent)
Keep two Ø8 inlets + fan/outlet holes so smoke reaches the sample volume while
the labyrinth keeps ambient light out. Matte-black PLA/PETG, 0.2 mm layers.

## Why these numbers
- Optical plane 22.5 = chamber mid-height; all three optical parts share it so
  beams and view overlap.
- Fin top 28 > bore top 25.3 → the baffle actually blocks light at the height
  the holes are, which the old 15 mm-tall fins did not.
- 7 mm square window clears the TSL2591 active area with margin and gives a flat
  PCB seating face a round bore can't.
- TSL at 90° vs LEDs at ~0° → ~90° side-scatter geometry with the 45° fin
  occluding the direct path. (Move the TSL toward 135° if you want a more
  forward-scatter, higher-sensitivity angle — keep a fin on the LED→TSL line.)
