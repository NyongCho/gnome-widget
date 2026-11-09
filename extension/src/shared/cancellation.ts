export class Cancellation {
    cancelled = false;
    private listeners = new Set<() => void>();
    onCancel(callback: () => void): () => void {
        if (this.cancelled) callback();
        else this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }
    cancel(): void {
        this.cancelled = true;
        for (const callback of this.listeners) callback();
        this.listeners.clear();
    }
}
