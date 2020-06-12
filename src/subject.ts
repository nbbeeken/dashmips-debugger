interface IWaiter {
    timeout: NodeJS.Timer | null
    resolve: (noRemove?: boolean) => void
}

export class Subject {
    private waiters: IWaiter[] = []

    public wait(timeout: number) {
        const waiter = {} as IWaiter
        this.waiters.push(waiter)
        const promise = new Promise<void>((resolve) => {
            let resolved = false
            waiter.resolve = (noRemove?: boolean) => {
                if (resolved) {
                    return
                }
                resolved = true
                if (waiter.timeout) {
                    clearTimeout(waiter.timeout)
                    waiter.timeout = null
                }
                if (!noRemove) {
                    const pos = this.waiters.indexOf(waiter)
                    if (pos > -1) {
                        this.waiters.splice(pos, 1)
                    }
                }
                resolve()
            }
        })
        if (timeout > 0 && isFinite(timeout)) {
            waiter.timeout = setTimeout(function () {
                waiter.timeout = null
                waiter.resolve()
            }, timeout)
        }
        return promise
    }

    public notify() {
        if (this.waiters.length > 0) {
            this.waiters.pop()?.resolve(true)
        }
    }

    public notifyAll() {
        for (let i = this.waiters.length - 1; i >= 0; i--) {
            this.waiters[i].resolve(true)
        }
        this.waiters = []
    }
}
