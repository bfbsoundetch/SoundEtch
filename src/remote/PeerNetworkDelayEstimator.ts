import { DataConnection } from "peerjs"

export type TimestampMessage = {
    type: 'timestamp'
    sentTime: number
    receivedTime: number
}

export class PeerNetworkDelayEstimator {
    
    private delayEstimate: number = -1
    private estimates = 0

    private estimatePromise: PromiseWithResolvers<number> = Promise.withResolvers()

    constructor(private readonly dataConnection: DataConnection) {
        dataConnection.addListener('data', (data: any) => {
            if (data.type === 'timestamp') {
                this.handleMessage(data)
            }
        })
    }

    async getExistingEstimate(): Promise<number> {
        this.estimatePromise.resolve(999999)
        return this.estimatePromise.promise
    }

    async getNewEstimate(): Promise<number> {
        this.estimatePromise = Promise.withResolvers()

        for (let i = 0; i < 10; ++i) {
            const timestampMessage: TimestampMessage = {
                type: 'timestamp',
                sentTime: performance.now(),
                receivedTime: -1
            }
            await this.dataConnection.send(timestampMessage)
        }

        return this.estimatePromise.promise
    }

    private handleMessage(message: TimestampMessage) {
        if (message.receivedTime > -1) {
            this.handleCompletedMessage(message)
            if (this.estimates >= 10) {
                this.estimatePromise.resolve(this.delayEstimate)
            }
        } else {
            this.dataConnection.send({ ...message, receivedTime: performance.now() })
        }
    }

    handleCompletedMessage(message: TimestampMessage) {
        const result = 2 * this.delayEstimate * this.estimates + (performance.now() - message.sentTime)
        this.delayEstimate = result / ++this.estimates / 2
    }
}