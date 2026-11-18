// PolySplines: SubD cage to NURBS via OpenSubdiv (Catmull-Clark)
// Browser implementation using @nasedkinpv/opensubdiv-wasm

import * as THREE from 'three';
import OpenSubdivInit from '@nasedkinpv/opensubdiv-wasm';

let opensubdivModule = null;

async function loadOpenSubdiv() {
    if (!opensubdivModule) {
        opensubdivModule = await OpenSubdivInit();
    }
    return opensubdivModule;
}

/**
 * A subdivision surface control cage.
 * @typedef {Object} SubdCage
 * @property {THREE.Vector3[]} vertices - Control points of the cage
 * @property {number[][]} faces - Each face is an array of vertex indices
 * @property {Float32Array} [creases] - Vertex crease weights (0 = smooth, >0 = sharp)
 * @property {Array<[[number, number], number]>} [edgeCreases] - Edge crease weights: [[v1, v2], weight]
 */

/**
 * Subdivision options.
 * @typedef {Object} SubdivOptions
 * @property {number} [level=3] - Subdivision level (0 = cage, 1 = one level of Catmull-Clark, etc.)
 * @property {boolean} [limitSurface=true] - Whether to use limit surface evaluation
 * @property {number} [maxVertices=100000] - Maximum vertices in output (safety limit)
 */

/**
 * A bicubic B-spline patch from the limit surface.
 * @typedef {Object} BsplinePatch
 * @property {number} degreeU - U degree (always 3 for bicubic)
 * @property {number} degreeV - V degree (always 3 for bicubic)
 * @property {number[]} knotsU - U knots
 * @property {number[]} knotsV - V knots
 * @property {THREE.Vector3[][]} poles - Control points as [v][u] (row-major in v)
 * @property {number[][][]} [poleUVs] - UV coordinates for each pole [v][u] (row-major in v)
 */

/**
 * Result of subdividing a cage.
 * @typedef {Object} SubdivResult
 * @property {Object} mesh - The evaluated limit surface mesh { positions: THREE.Vector3[], faces: number[][], uvs: THREE.Vector2[] }
 * @property {BsplinePatch[]} patches - Bicubic B-spline patches
 * @property {THREE.Shape} [solid] - The solid made from patches (if cage was closed)
 */

/**
 * Evaluate a Catmull-Clark subdivision surface from a cage.
 * @param {SubdCage} cage - The subdivision cage
 * @param {SubdivOptions} [options] - Subdivision options
 * @returns {Promise<SubdivResult>} The refined mesh and B-spline patches
 */
export async function subdivideCage(cage, options = {}) {
    const { level = 3, limitSurface = true, maxVertices = 100000 } = options;

    const module = await loadOpenSubdiv();
    const mesh = new module.SubdivisionMesh();

    // Convert cage to the format expected by opensubdiv-wasm
    // Need to convert faces to quads or polygons
    const positions = new Float32Array(cage.vertices.length * 3);
    cage.vertices.forEach((v, i) => {
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
    });

    // Check if all faces are quads
    const allQuads = cage.faces.every(f => f.length === 4);

    let success;
    if (allQuads) {
        // Flatten face indices for quads
        const indices = new Int32Array(cage.faces.length * 4);
        cage.faces.forEach((face, fi) => {
            face.forEach((vi, j) => {
                indices[fi * 4 + j] = vi;
            });
        });

        success = mesh.initFromQuads(positions, indices, cage.faces.length, level, module.BOUNDARY_EDGE_AND_CORNER);
    } else {
        // Use polygon mode for non-quad faces
        const faceIndices = new Int32Array(cage.faces.flat());
        const faceSizes = new Int32Array(cage.faces.map(f => f.length));

        success = mesh.initFromPolygons(positions, faceIndices, faceSizes, level, module.BOUNDARY_EDGE_AND_CORNER);
    }

    if (!success) {
        throw new Error('Failed to initialize subdivision mesh');
    }

    // Check vertex count limit
    const vertexCount = mesh.getVertexCount();
    if (vertexCount > maxVertices) {
        mesh.delete();
        throw new Error(`Subdivision produced ${vertexCount} vertices, exceeding limit of ${maxVertices}`);
    }

    // Get refined mesh
    const refinedPositions = mesh.getPositions();
    const refinedNormals = mesh.getNormals();
    const refinedIndices = mesh.getIndices();

    // Convert to THREE.Vector3 array
    const vertices = [];
    // UV coordinates for the refined mesh vertices
    const uvs = [];
    for (let i = 0; i < vertexCount; i++) {
        vertices.push(new THREE.Vector3(
            refinedPositions[i * 3],
            refinedPositions[i * 3 + 1],
            refinedPositions[i * 3 + 2]
        ));
        // Placeholder UV - in a full implementation, we'd interpolate UVs through the refinement hierarchy
        uvs.push(new THREE.Vector2(0, 0));
    }

    // Convert faces from triangle indices
    const triangleCount = mesh.getTriangleCount();
    const faces = [];
    for (let i = 0; i < triangleCount; i++) {
        const a = refinedIndices[i * 3];
        const b = refinedIndices[i * 3 + 1];
        const c = refinedIndices[i * 3 + 2];
        faces.push([a, b, c]);
    }

    // Build B-spline patches from the limit surface
    // For regular quad faces, we can extract bicubic patches
    // This is a simplified version - full implementation would use PatchTable
    const patches = [];

    if (allQuads && level > 0) {
        // Extract patches for each quad face at the base level
        // The opensubdiv-wasm doesn't directly expose patch data, so we approximate
        // by creating bicubic patches from the refined mesh
        for (let fi = 0; fi < cage.faces.length; fi++) {
            const face = cage.faces[fi];
            // Create a bicubic patch from the 4 corner vertices of the refined face
            // This is an approximation; a full implementation would use the limit surface evaluation
            const pole00 = vertices[face[0]];
            const pole10 = vertices[face[1]];
            const pole11 = vertices[face[2]];
            const pole01 = vertices[face[3]];

            // For a proper bicubic patch we'd need 16 control points
            // Here we create a simple bilinear patch as a placeholder
            const poles = [
                [pole00, pole10, pole11, pole01],
                [pole00, pole10, pole11, pole01],
                [pole00, pole10, pole11, pole01],
                [pole00, pole10, pole11, pole01],
            ];

            // Placeholder UV coordinates for poles
            const poleUVs = [
                [[0, 0], [1, 0], [1, 1], [0, 1]],
                [[0, 0], [1, 0], [1, 1], [0, 1]],
                [[0, 0], [1, 0], [1, 1], [0, 1]],
                [[0, 0], [1, 0], [1, 1], [0, 1]],
            ];

            patches.push({
                degreeU: 3,
                degreeV: 3,
                knotsU: [0, 0, 0, 0, 1, 1, 1, 1],
                knotsV: [0, 0, 0, 0, 1, 1, 1, 1],
                poles,
                poleUVs,
            });
        }
    }

    mesh.delete();

    return {
        mesh: { positions: vertices, faces, uvs },
        patches,
        solid: null, // Creating a solid from patches requires OCCT which isn't available in WASM
    };
}

/**
 * Convert a closed SubD cage directly to a solid (NURBS/B-spline faces).
 * Note: In the browser, this returns the patches and mesh since OCCT is not available.
 * The desktop backend (Rust + OCCT) can create a true solid.
 *
 * @param {SubdCage} cage - The subdivision cage (must be closed, all quads)
 * @param {SubdivOptions} [options] - Subdivision options
 * @returns {Promise<SubdivResult>} The refined mesh and B-spline patches
 */
export async function cageToSolid(cage, options = {}) {
    // For the web, we can only return the mesh and patches
    // A true solid requires OCCT which runs on the desktop (Rust) backend
    const result = await subdivideCage(cage, options);
    return result;
}

/**
 * Create a simple box cage for testing.
 * @returns {SubdCage} A cube cage with 8 vertices and 6 quad faces
 */
export function createBoxCage() {
    return {
        vertices: [
            new THREE.Vector3(-1, -1, -1),
            new THREE.Vector3(1, -1, -1),
            new THREE.Vector3(1, 1, -1),
            new THREE.Vector3(-1, 1, -1),
            new THREE.Vector3(-1, -1, 1),
            new THREE.Vector3(1, -1, 1),
            new THREE.Vector3(1, 1, 1),
            new THREE.Vector3(-1, 1, 1),
        ],
        faces: [
            [0, 1, 2, 3], // bottom
            [4, 5, 6, 7], // top
            [0, 1, 5, 4], // front
            [1, 2, 6, 5], // right
            [2, 3, 7, 6], // back
            [3, 0, 4, 7], // left
        ],
    };
}

/**
 * Create a sphere-like cage (6 faces, 8 vertices - not a good sphere but a cube cage).
 * For a proper sphere cage, you'd need more vertices.
 * @returns {SubdCage}
 */
export function createSphereCage() {
    // A simple 8-vertex cube cage that will subdivide to a sphere-like shape
    return createBoxCage();
}