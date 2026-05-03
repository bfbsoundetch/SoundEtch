export type TimestampMessage = {
    type: 'timestamp'
    sentTime: number
    receivedTime: number
}

export class PeerNetworkDelayEstimator {
    
    private delayEstimate: number = -1
    private estimates = 0

    getNewSendMessage(): TimestampMessage {
        return {
            type: 'timestamp',
            sentTime: performance.now(),
            receivedTime: -1
        }
    }

    handleMessage(message: TimestampMessage): TimestampMessage | null {
        if (message.receivedTime > -1) {
            this.handleCompletedMessage(message)
            return null
        }
        return { ...message, receivedTime: performance.now() }
    }

    handleCompletedMessage(message: TimestampMessage) {
        const result = this.delayEstimate * this.estimates + (performance.now() + message.sentTime)
        this.delayEstimate = result / ++this.estimates
    }

}