import * as THREE from 'three';
import { GeometryFactory, NoOpError, ValidationError } from './GeometryFactory.js';
import { booleanWithHistory, count, extrudeFace, makeProfileFace, volume } from './Kernel.js';
import { faceBase, shapedExtrude } from './Forms.js';

// Push/pull extrude that becomes a boolean when it meets a body, modeled on Plasticity's
// PossiblyBooleanExtrudeFactory (src/commands/extrude/ExtrudeFactory.ts). Positive distance
// joins, negative distance cuts (ExtrudeFactory.ts:115-117); no contact means a new body.
// All geometry is exact OpenCascade B-rep, where Plasticity calls C3D's ExtrusionSolid and UnionResult.

export class ExtrudeFactory extends GeometryFactory {
    constructor(doc) {
        super(doc);
        /** @type {THREE.Shape | undefined} 2D profile in the sketch plane */
        this.profile = undefined;
        this.origin = new THREE.Vector3();
        this.normal = new THREE.Vector3(0, 0, 1);
        this.xAxis = new THREE.Vector3(1, 0, 0);
        this.distance = 0;
        /** @type {string | undefined} body the sketch sits on */
        this.target = undefined;
        /** 'auto' picks union/difference from the sign of distance; 'new' always makes a separate
         * body; 'union', 'difference' and 'intersection' force that boolean (Plasticity's Q, W, Shift+E) */
        this.operation = 'auto';
        /** @type {number | undefined} extrude this face of the target instead of the profile */
        this.face = undefined;
        /** An exact face to extrude instead of `profile` (a drawn region). */
        this.baseFace = undefined;
        /** Plasticity's Extrude options: the other way as well (S), the sides' lean in radians (A)
         * and a wall thickness (Shift+T). */
        this.back = 0;
        this.angle = 0;
        this.thickness = 0;
        this.isOverlapping = false;
    }

    get frame() {
        const z = this.normal.clone().normalize();
        const x = this.xAxis.clone().projectOnPlane(z).normalize();
        const y = new THREE.Vector3().crossVectors(z, x);
        return new THREE.Matrix4().makeBasis(x, y, z).setPosition(this.origin);
    }

    get operationType() {
        if (this.operation !== 'auto') return this.operation;
        return this.distance > 0 ? 'union' : 'difference';
    }

    get plain() { return Math.abs(this.back) < 1e-12 && Math.abs(this.angle) < 1e-12 && Math.abs(this.thickness) < 1e-12 }

    tool() {
        if (Math.abs(this.distance) < 1e-6 && Math.abs(this.back) < 1e-6) throw new NoOpError();
        const shaped = (face, n) => shapedExtrude(face, n, this.distance, this.back, this.angle, this.thickness);
        if (this.face !== undefined) {
            if (this.plain) return extrudeFace(this.doc.shape(this.target), this.face, this.distance);
            const { face, normal } = faceBase(this.doc.shape(this.target), this.face);
            return shaped(face, normal);
        }
        if (!this.baseFace && !this.profile) throw new ValidationError("No profile to extrude");
        return shaped(this.baseFace ?? makeProfileFace(this.profile, this.frame), this.normal.clone().normalize());
    }

    async calculate() {
        const tool = this.tool();
        const body = this.target !== undefined ? this.doc.shape(this.target) : undefined;
        const op = this.operationType;
        if (body === undefined || op === 'new') {
            this.isOverlapping = false;
            return [{ shape: tool }];
        }

        if (op === 'slice') {
            // Plasticity's Shift+Q: the body cut in two along the tool; the part inside is a new body.
            const { shape: rest, history } = booleanWithHistory(body, tool, 'difference');
            const piece = booleanWithHistory(body, tool, 'intersection').shape;
            this.isOverlapping = volume(piece) > 1e-9 && volume(rest) > 1e-9;
            if (!this.isOverlapping) throw new ValidationError("the slice does not cut through the body");
            return [{ shape: rest, replaces: this.target, history }, { shape: piece }];
        }
        const { shape: result, history } = booleanWithHistory(body, tool, op);
        // Touching or overlapping fuses into one solid; a cut that removes nothing missed the body.
        this.isOverlapping = op === 'union'
            ? count(result, 'TopAbs_SOLID') === count(body, 'TopAbs_SOLID')
            : op === 'difference' ? Math.abs(volume(result) - volume(body)) > 1e-9 : volume(result) > 1e-9;
        if (!this.isOverlapping) {
            if (this.operation === 'auto' || this.operation === 'union') return [{ shape: tool }];
            throw new ValidationError("the extrude does not meet the body");
        }
        if (count(result, 'TopAbs_SOLID') === 0) throw new ValidationError("Boolean produced an empty body");
        return [{ shape: result, replaces: this.target, history }];
    }

    async calculatePhantoms() {
        if (this.target === undefined || this.operation === 'new') return [];
        let tool;
        try { tool = this.tool() } catch { return [] }
        return [{ shape: tool, kind: ['difference', 'slice'].includes(this.operationType) ? 'cut' : 'add' }];
    }
}
