import { EqEffect } from '../../effects/Effects';
import { Track } from '../../project/Track';
import { BottomPanelController } from '../BottomPanelController';
import { WEQ8Runtime } from 'weq8';

export class EqPanelController {

    private weq8: WEQ8Runtime | null = null

    constructor(
        private readonly bottomPanelController: BottomPanelController,
    ) {}

    open(audioContext: AudioContext, track: Track, effect: EqEffect) {
        this.weq8 = new WEQ8Runtime(audioContext)
        const weq8Element = document.createElement('weq8-ui')
        this.bottomPanelController.open({
            title: 'Equalizer',
            subtitle: `${track.name}: ${effect.startPosition} ${effect.startPosition + effect.length}`,
            body: weq8Element,
            onClose: () => {},
        })
        this.weq8.on('filtersChanged', (state) => {
            state[0]
        })
    }

}
