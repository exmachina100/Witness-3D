# Licensed kernels vs. building our own: access, difficulty, strategy

Written 2026-10-13. This follows on from [licensed-features-status.md](licensed-features-status.md). Prices come only from the public pages linked under Sources. Anything marked *inferred* is my reading, not a published fact.

## 1. Can we get access?

Yes, all of these are sold to software developers. None of them is free for a commercial app, and you can't use any of them by taking them out of Plasticity's installer. Each needs its own agreement with the vendor.

| Kernel | Who sells it | Public terms | Route for a small team |
|---|---|---|---|
| **Parasolid** (Siemens) | Siemens, and resold by Tech Soft 3D in three tiers: Designer, Editor and Communicator | No public price. Tech Soft 3D's page offers "Evaluate Siemens Parasolid" and "Talk to an Expert". | Ask for an evaluation. Commercial terms are negotiated. *Inferred:* expect a yearly fee plus a royalty per copy sold, in the five-figure range or more. Plasticity pays this as a funded company. |
| **xNURBS** | xNURBS (the XN Kernel) | The only public developer access is the "API package" for its Rhino plugin, which works only for people who hold an xNURBS Rhino licence. An OEM licence for the XN Kernel needs contacting xNURBS. | Email xNURBS support for an OEM quote. *Inferred:* it's a small company that already licenses Plasticity, so it's likely open to a deal. |
| **HOOPS Exchange** (Tech Soft 3D) | Tech Soft 3D | No public price. Has a free evaluation licence. | Evaluation first, then a quote. *Inferred:* it's priced for commercial CAD vendors. |
| **ODA** (DWG/DXF) | Open Design Alliance | Public prices. Commercial membership is $3,000 the first year, then $2,250 a year, for "limited commercial use". Sustaining is $7,500, then $4,500 a year, for unlimited commercial use. You lose the right to distribute if you stop paying. | This is the cheapest and most predictable of the four. It only matters if DWG becomes important. |
| *(alternative)* **C3D** (C3D Labs) | C3D Labs, Plasticity's kernel until 2023 | No price checked. | *Inferred:* historically more open to small developers than Parasolid, and worth a quote as a middle option. |

## 2. How hard is each to replicate on open source?

**Weeks of work each, because OpenCascade (LGPL) already has the algorithm:**
- Imprint, Cut and Project, plus K knife mode.
- Thicken, Draft Face, Pipe, guide curves for Loft and Sweep, Extend Sheet, and Rebuild Face/Raise Degree.
- An N-sided patch fill at "good, not xNURBS" quality, using `BRepOffsetAPI_MakeFilling`, and a four-sided Coons fill.
- Bridge Surface, built from a blend with tangent constraints.
- Healing imports with `ShapeFix` and Defeaturing, so it is weaker than BodyShop.
- DXF read and write, written ourselves. The format is open and documented.
- Rhino `.3dm` import and export through **openNURBS**, McNeel's free library. This is a bonus format Plasticity doesn't read.
- Surface-quality display (zebra stripes, curvature), done with Three.js shaders.

**Months of work each, harder geometry but known methods:**
- **PolySplines**, which turn a SubD cage into NURBS. **OpenSubdiv** (Pixar, Apache 2.0) evaluates the limit surface. Turning that into clean, exact-enough B-spline patches, including around irregular vertices, is our own code.
- **Variable-radius fillets, Fillet Shell and Y-blends.** OCCT has variable radius. Getting robust corners where three fillets meet is where OCCT fails most. We'd need our own corner-patch fallback built on the patch fill.
- **Unwrap Face.** Flattening a mesh is solved in open-source libraries (libigl's LSCM, MPL 2.0). Fitting the result back onto a trimmed surface is our code.
- **Match Face to G2.** This means moving control points to match curvature across an edge. It's well described in the literature, but there's no ready-made library.

**Research-scale, not realistic to match:**
- **xNURBS-quality fills.** xNURBS is built on its maker's own energy-minimising surface method, and it's their whole product. With OCCT plus tuning we can get close enough for most models, but not equal.
- **Parasolid-level robustness overall,** meaning Booleans, offsets and fillets that almost never fail. That comes from 30+ years of edge-case work. OCCT fails more often, and the gap closes one bug at a time.
- **SAT and X_T files.** Both formats are proprietary, so they're only available through a licence.

## 3. Recommended strategy

1. **Keep building on OpenCascade, behind the `Kernel` trait we already have.** The trait exists so that a licensed kernel can be added later without rewriting the app. Keep every new tool calling through it rather than calling OCCT directly. The desktop build is where all the heavy geometry lives. The browser build stays a demo.
2. **Next, build the weeks-scale features above, in this order:**
   1. Imprint, Cut and Project, which also gives K knife on every tool.
   2. The patch fill and Bridge Surface.
   3. Thicken, Draft Face, Pipe and the guide curves.
   4. Zebra and curvature display, so we can judge surface quality.
   5. DXF and `.3dm`.
3. **Then the months-scale ones,** starting with PolySplines on OpenSubdiv, because that is the feature Plasticity users talk about.
4. **Ask for quotes now, but don't buy yet.** Evaluations of Parasolid and xNURBS are free to ask for and would show the real numbers. Buying makes sense once one of these is true: Witness 3D has paying users or funding, OCCT failures (fillets, Booleans) are the top complaint, or a single feature (xNURBS fills) is blocking sales. xNURBS is the likeliest first purchase. It's one focused library, and it plugs into one tool, the patch fill, behind the same trait.
5. **What stays off-limits:** using or extracting the DLLs that ship in Plasticity's installer. That is unlicensed use, whatever the technical route.

## Sources
- [Tech Soft 3D: Parasolid](https://www.techsoft3d.com/products/parasolid)
- [engineering.com: Parasolid, D-Cubed and Siemens](https://www.engineering.com/parasolid-d-cubed-and-siemens-the-heart-of-your-cad-software-belongs-to-another/)
- [ODA membership pricing](https://www.opendesign.com/pricing.md)
- [xNURBS API package (food4rhino)](https://www.food4rhino.com/en/app/api-package-xnurbs-rhino-plugin)
- [HOOPS Exchange environment setup (evaluation licence)](https://docs.techsoft3d.com/exchange/latest/tutorials/environment-setup.html)
