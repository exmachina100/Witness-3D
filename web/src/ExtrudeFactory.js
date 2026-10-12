import * as THREE from 'three';
import { GeometryFactory, NoOpError, ValidationError } from './GeometryFactory.js';
import { booleanWithHistory, count, extrudeFace, makeProfileFace, prism, volume } from './Kernel.js';

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

    tool() {
        if (Math.abs(this.distance) < 1e-6) throw new NoOpError();
        if (this.face !== undefined) return extrudeFace(this.doc.shape(this.target), this.face, this.distance);
        if (!this.profile) throw new ValidationError("No profile to extrude");
        const face = makeProfileFace(this.profile, this.frame);
        return prism(face, this.normal.clone().normalize().multiplyScalar(this.distance));
    }

    async calculate() {
        const tool = this.tool();
        const body = this.target !== undefined ? this.doc.shape(this.target) : undefined;
        const op = this.operationType;
        if (body === undefined || op === 'new') {
            this.isOverlapping = false;
            return [{ shape: tool }];
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
        return [{ shape: tool, kind: this.operationType === 'difference' ? 'cut' : 'add' }];
    }
}
