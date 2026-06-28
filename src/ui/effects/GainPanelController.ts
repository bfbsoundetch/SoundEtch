import { EqEffect } from 'effects/Effects';
import { Track } from 'project/Track';
import { BottomPanelController } from 'ui/BottomPanelController';
import { WEQ8Runtime } from 'weq8';

export class GainPanelController {

    constructor(
        private readonly bottomPanelController: BottomPanelController,
    ) {}

    open(audioContext: AudioContext, track: Track, effect: EqEffect) {

    }

}