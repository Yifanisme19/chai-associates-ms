<?php

declare(strict_types=1);

namespace Chai;

/** Printable counterpart of the non-editing quotation Preview. Always uses the saved snapshot. */
final class QuotationDocument
{
    public static function html(array $quotation): string
    {
        $input = $quotation['input'];
        $calculation = $quotation['calculation'];
        $layout = array_replace([
            'document_title' => 'PROFORMA',
            'professional_heading' => 'PROFESSIONAL FEES:-',
            'professional_intro' => 'Services rendered including taking instructions to prepare the following:-',
            'disbursement_heading' => 'DISBURSEMENTS:-',
            'footer_note' => '*Kindly be informed that this Proforma is subject to adjustments should there be any variation in the nature, complexity, or scope of the matter.',
        ], (array) $calculation['layout']);
        $escape = fn ($value) => htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $money = fn ($value) => 'RM '.number_format((float) $value, 2);
        $items = array_values(array_filter($calculation['items'], fn ($item) => ! ($item['hidden'] ?? false)));
        usort($items, fn ($a, $b) => ($a['sort_order'] ?? 0) <=> ($b['sort_order'] ?? 0));
        $groups = [];
        $taxableTotal = 0;
        foreach ($items as $item) {
            $code = $item['section_code'] ?? 'others';
            $groups[$code] ??= ['code' => $code, 'name' => $item['section_name'] ?? 'Others', 'category' => $item['category'], 'items' => []];
            $groups[$code]['items'][] = $item;
            if ($item['sst_applicable']) {
                $taxableTotal += $item['amount'];
            }
        }
        $sections = array_values($groups);
        $hasCategories = isset($layout['categories']);
        $categoryKey = fn ($s) => $layout['section_categories'][$s['code']] ?? $s['category'];
        $categories = array_column($layout['categories'] ?? [], null, 'code');
        if ($hasCategories) {
            $order = array_flip(array_keys($categories));
            usort($sections, fn ($a, $b) => ($order[$categoryKey($a)] ?? -1) <=> ($order[$categoryKey($b)] ?? -1));
        }
        $disbursements = array_values(array_filter($sections, fn ($s) => $s['category'] === 'disbursement'));
        $firstDisbursement = $disbursements[0]['code'] ?? null;
        $lastDisbursement = $disbursements ? $disbursements[count($disbursements) - 1]['code'] : null;
        $rate = $taxableTotal ? $calculation['summary']['sst'] / $taxableTotal : 0;
        $rows = '';
        $heading = fn ($class, $value) => '<tr class="'.$class.'"><td colspan="4">'.$escape($value).'</td></tr>';
        $subtotal = fn ($amount, $tax = '') => '<tr class="subtotal-row"><td></td><td></td><td class="number">'.$money($amount).'</td><td class="number">'.$tax.'</td></tr>';
        foreach ($sections as $index => $section) {
            $key = $categoryKey($section);
            $startsCategory = $index === 0 || $categoryKey($sections[$index - 1]) !== $key;
            if ($hasCategories && $startsCategory) {
                $rows .= $heading('section-row', $categories[$key]['name'] ?? '');
            }
            if (! $hasCategories && $section['category'] === 'professional') {
                $rows .= $heading('section-row', $layout['professional_heading']);
            }
            if ($section['category'] === 'professional' && $startsCategory) {
                $rows .= $heading('intro-row', $layout['professional_intro']);
            }
            if (! $hasCategories && $section['code'] === $firstDisbursement) {
                $rows .= $heading('section-row', $layout['disbursement_heading']);
            }
            if ($section['category'] === 'disbursement') {
                $rows .= $heading('group-row', $section['name']);
            }
            foreach ($section['items'] as $item) {
                $rows .= '<tr class="fee-row"><td>'.$escape($item['description']).'</td><td class="number">'.$money($item['amount']).'</td><td></td><td class="number">'.($item['sst_applicable'] ? $money($item['amount'] * $rate) : '-').'</td></tr>';
            }
            if (! $hasCategories && $section['category'] === 'professional') {
                $rows .= $subtotal($calculation['summary']['professional_fees'], '-');
            }
            if (! $hasCategories && $section['code'] === $lastDisbursement) {
                $rows .= $subtotal($calculation['summary']['disbursements']);
            }
            if ($hasCategories && ($index === count($sections) - 1 || $categoryKey($sections[$index + 1]) !== $key)) {
                $total = 0;
                foreach ($sections as $s) {
                    if ($categoryKey($s) === $key) {
                        $total += array_sum(array_column($s['items'], 'amount'));
                    }
                }
                $rows .= $subtotal($total);
            }
        }
        $rows .= '<tr class="total-row"><td colspan="3">Total SST Payable</td><td class="number">'.$money($calculation['summary']['sst']).'</td></tr>';
        $rows .= '<tr class="grand-total-row"><td colspan="3">TOTAL PAYABLE INCLUSIVE OF SST</td><td class="number">'.$money($calculation['summary']['total_payable']).'</td></tr>';
        $date = new \DateTimeImmutable($input['quotation_date'], new \DateTimeZone('Asia/Kuala_Lumpur'));
        $ref = ($input['ref_code'] ?? '') ?: $quotation['number'];
        $meta = '';
        foreach (['PIC' => $input['pic'] ?? '', 'Ref' => $ref, 'Client' => $input['client_name'], 'Re' => $input['reference'] ?? ''] as $label => $value) {
            $meta .= '<tr><td class="label">'.$label.'</td><td class="colon">:</td><td class="value">'.$escape($value ?: '-').'</td>';
            if ($label === 'PIC') {
                $meta .= '<td class="date-label">Date</td><td class="colon">:</td><td class="date-value">'.$escape($date->format('j F Y')).'</td>';
            } else {
                $meta .= '<td colspan="3"></td>';
            }
            $meta .= '</tr>';
        }
        $footer = $layout['footer_note'] ? '<p class="excel-note">'.$escape($layout['footer_note']).'</p>' : '';
        $sstLabel = str_replace('.00', '', number_format($rate * 100, 2));
        $title = $escape($layout['document_title']);

        return '<!doctype html><html><head><meta charset="utf-8"><title>'.$escape($quotation['number']).'</title><style>
@page { margin: 0; }
html, body { margin: 0; padding: 0; color: #111; font-family: DejaVu Sans, sans-serif; font-size: 12px; }
.excel-title { margin: 0 0 20px; text-align: center; font-size: 17.6px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.excel-meta { table-layout: auto; margin-bottom: 16px; font-size: 11.52px; }
.excel-meta td { vertical-align: top; padding: 2px 0; line-height: 1.4; word-wrap: break-word; }
.excel-meta .label { width: 46px; font-weight: bold; }
.excel-meta .colon { width: 12px; }
.excel-meta .date-label { width: 36px; font-weight: bold; }
.excel-meta .date-value { width: 168px; }
.excel-table { font-size: 10.88px; }
.excel-table th { border-top: 1px solid #222; border-bottom: 1px solid #222; padding: 5.6px 4.8px; text-align: center; font-weight: normal; }
.excel-table td { padding: 3.2px 4.8px; vertical-align: top; line-height: 1.35; word-wrap: break-word; }
.excel-table td.number { text-align: right; white-space: nowrap; }
.excel-table .section-row td { padding-top: 10.4px; font-size: 11.52px; font-weight: bold; text-align: left; }
.excel-table .intro-row td { padding-top: 4.8px; padding-bottom: 8.8px; text-align: left; line-height: 1.4; }
.excel-table .group-row td { padding-top: 8.8px; padding-bottom: 4px; text-align: left; font-weight: bold; }
.excel-table .subtotal-row td { border-top: 1px solid #222; }
.excel-table .total-row td { border-top: 1px solid #222; border-bottom: 1px solid #222; }
.excel-table .grand-total-row td { border-bottom: 1px solid #222; font-weight: bold; }
.excel-table .total-row td:first-child, .excel-table .grand-total-row td:first-child { text-align: left; }
.excel-note { margin: 17.6px auto 0; width: 90%; font-size: 9.28px; line-height: 1.4; word-wrap: break-word; }
#document-end { height: 1px; margin: 0; padding: 0; }
</style></head><body><h2 class="excel-title">'.$title.'</h2><table class="excel-meta"><colgroup><col width="46"><col width="12"><col width="444"><col width="36"><col width="12"><col width="168"></colgroup><tbody>'.$meta.'</tbody></table><table class="excel-table"><colgroup><col style="width:47%"><col style="width:19%"><col style="width:16%"><col style="width:18%"></colgroup><thead><tr><th style="width:47%"></th><th style="width:19%">Amount</th><th style="width:16%">Total</th><th style="width:18%">SST Rate '.$sstLabel.'%</th></tr></thead><tbody>'.$rows.'</tbody></table>'.$footer.'<div id="document-end"></div></body></html>';
    }
}
