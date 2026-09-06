<script setup lang="ts">
import { confirmation, answerConfirmation } from '@/lib/confirmAction';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
</script>
<template>
    <Dialog :open="!!confirmation" @update:open="open => { if (!open) answerConfirmation(false); }">
        <DialogContent class="max-w-md">
            <DialogHeader><DialogTitle>Confirm deletion</DialogTitle><DialogDescription>{{ confirmation?.message }}</DialogDescription></DialogHeader>
            <DialogFooter class="gap-2"><Button variant="outline" @click="answerConfirmation(false)">Cancel</Button><Button variant="destructive" @click="answerConfirmation(true)">Delete</Button></DialogFooter>
        </DialogContent>
    </Dialog>
</template>
