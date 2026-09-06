import { ref } from 'vue';
export const confirmation = ref<{ message: string; resolve: (value: boolean) => void } | null>(null);
export function confirmAction(message: string): Promise<boolean> {
    confirmation.value?.resolve(false);
    return new Promise(resolve => { confirmation.value = { message, resolve }; });
}
export function answerConfirmation(value: boolean) {
    confirmation.value?.resolve(value);
    confirmation.value = null;
}
