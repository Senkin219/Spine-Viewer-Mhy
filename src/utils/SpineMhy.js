import { Spine } from "pixi-spine";
import { AutoBone, BoneSpeedConfig } from './mhy_spine.ts';

export class SpineMhy extends Spine {
    constructor(skeletonData) {
        super(skeletonData);
        this.autoBone = Object.values(skeletonData.extra || {}).map(value => {
            return new AutoBone(value, this);
        });
        this.autoBoneSpeed = new BoneSpeedConfig(skeletonData.extraConfig || {});
    }
    autobone = 1;
    disableSlotColor = 1;
    update(dt) {
        if (this.autobone == 1) {
            let i = 1;
            let a = null;
            let lastFrameTime = Date.now() / 1000;
            const o = lastFrameTime * this.autoBoneSpeed.timeScale * this.state.timeScale;
            if (this.state.tracks[0]) {
                i = this.state.tracks[0].mixDuration ? Math.min(1, this.state.tracks[0].mixTime / this.state.tracks[0].mixDuration) : 1;
                if (i < 1 && this.state.tracks[0].mixingFrom) {
                    a = this.state.tracks[0].mixingFrom.animation.name;
                }
            }
            const s = Math.min(2, Math.abs(o - this.prevTime) / .0167);
            this.prevTime = o;
            this.autoBone.forEach(bone => bone.render(s, o, i, a));
        }
        if (this.disableSlotColor == 1) {
            const delayLimit = this.delayLimit;
            if (dt > delayLimit) dt = delayLimit;
            this.state.update(dt);
            this.state.apply(this.skeleton);
            for (let i = 0, n = this.skeleton.slots.length; i < n; i++) {
                this.skeleton.slots[i].color.r = 1;
                this.skeleton.slots[i].color.g = 1;
                this.skeleton.slots[i].color.b = 1;
            }
            let update = this.state.update;
            let apply = this.state.apply;
            this.state.update = () => { };
            this.state.apply = () => { };
            super.update(dt);
            this.state.update = update;
            this.state.apply = apply;
        }
        else {
            super.update(dt);
        }
    }
}