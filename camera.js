"use strict";

class ThirdPersonCamera {
    constructor({ distance = 7, height = 5, smoothing = 0.12} = {}) {
        this.distance = distance;
        this.height = height;
        this.smoothing = smoothing;
        this.Zoom = 45;

        this.Position = glMatrix.vec3.fromValues(0.0, height, distance)
        this._desiredPos = glMatrix.vec3.create();
        this._lookTarget = glMatrix.vec3.create();
    }

    update(targetPos, targetDir, deltaTime) {
        glMatrix.vec3.set(this._desiredPos,
            targetPos[0] - targetDir[0] * this.distance,
            targetPos[1] + this.height,
            targetPos[2] - targetDir[1] * this.distance
        );

        const t = Math.min(1.0, this.smoothing * deltaTime * 60);
        glMatrix.vec3.lerp(this.Position, this.Position, this._desiredPos, t);

        glMatrix.vec3.set(this._lookTarget, targetPos[0], targetPos[1] + 0.5, targetPos[2]);
    }

    getViewMatrix(out) {
        glMatrix.mat4.lookAt(out, this.Position, this._lookTarget,
            glMatrix.vec3.fromValues(0, 1, 0)
        )
        
        return out;
    }
}