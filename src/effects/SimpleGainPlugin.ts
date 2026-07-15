import { WebAudioModule } from '@webaudiomodules/sdk';
import { ParamMgrFactory, CompositeAudioNode, ParamMgrNode } from '@webaudiomodules/sdk-parammgr';

class GainWamAudioNode extends CompositeAudioNode {
	setUp(output: AudioNode, paramMgr: ParamMgrNode) {
		this.connect(output, 0, 0);
		this._wamNode = paramMgr;
		this._output = output;
	}
}

export default class GainWam extends WebAudioModule {
	async createAudioNode(initialState: any) {
        const gainNode = new GainNode(this.audioContext)
        
        const compositeNode = new GainWamAudioNode(this.audioContext)

		const internalParamsConfig = {
            gain: gainNode.gain
		}

        const paramMgrNode = await ParamMgrFactory.create(this, { internalParamsConfig })

        compositeNode.setUp(gainNode, paramMgrNode)

        if (initialState) compositeNode.setState(initialState)

		return compositeNode
	}
}