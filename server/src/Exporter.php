<?php

declare(strict_types=1);

namespace Chai;

use Dompdf\Dompdf;
use Dompdf\Options;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

final class Exporter
{
    private static function e(mixed $v): string
    {
        return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public static function html(array $q): string
    {
        $e = self::e(...);
        $rm = fn ($n) => number_format((float) $n, 2);
        $i = $q['input'];
        $c = $q['calculation'];
        $layout = $c['layout'];
        $rows = '';
        $section = '';
        foreach ($c['items'] as $item) {
            if ($item['hidden']) {
                continue;
            }if ($section !== $item['section_code']) {
                $section = $item['section_code'];
                $rows .= '<tr class="section"><td colspan="2">'.$e($item['section_name']).'</td></tr>';
            }$rows .= '<tr><td>'.$e($item['description']).($item['sst_applicable'] ? ' *' : '').'</td><td class="amount">'.$rm($item['amount']).'</td></tr>';
        }
        foreach (['Professional fees' => 'professional_fees', 'Disbursements' => 'disbursements', 'SST (* taxable items)' => 'sst', 'Total payable' => 'total_payable'] as $label => $key) {
            $rows .= '<tr'.($key === 'total_payable' ? ' class="total"' : '').'><td>'.$label.'</td><td class="amount">'.$rm($c['summary'][$key]).'</td></tr>';
        }

        return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:11px DejaVu Sans,sans-serif;color:#191919}h1{font-size:20px}h2{font-size:17px}p{white-space:pre-line;line-height:1.5}table{width:100%;border-collapse:collapse}td{padding:6px 3px;border-bottom:1px solid #eee}.amount{text-align:right;white-space:nowrap}.section{font-weight:bold;background:#f3f3f3}thead{display:table-header-group}tr{page-break-inside:avoid}.total{font-size:15px;font-weight:bold}footer{font-size:10px;margin-top:25px;white-space:pre-line}</style></head><body><h1>CHAI &amp; ASSOCIATES</h1><p>'.$e(implode("\n", $layout['company_lines'] ?? [])).'</p><h2>'.$e($layout['document_title'] ?? 'PROFORMA').'</h2><p>Quotation: '.$e($i['ref_code'] ?? $q['number']).' · '.$e($i['quotation_date'])."\nClient: ".$e($i['client_name'])."\nPIC: ".$e($i['pic'] ?? '')."\nReference: ".$e($i['reference'] ?? '')."\n".$e($c['template_snapshot']['name']).' · Version '.$c['template_snapshot']['version'].'</p><table><thead><tr><th align="left">Description</th><th align="right">Amount (RM)</th></tr></thead><tbody>'.$rows.'</tbody></table><p>Loan / property amount: RM '.$rm($i['loan_amount'])."\nTotal financing: RM ".$rm($c['summary']['total_financing']).'</p><footer>'.$e($layout['footer_note'] ?? '')."\n".$e(implode("\n", $layout['payment_lines'] ?? [])).'</footer></body></html>';
    }

    public static function pdf(array $q): string
    {
        $options = new Options;
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $options->set('chroot', __DIR__);
        $pdf = new Dompdf($options);
        $pdf->loadHtml(self::html($q));
        $pdf->setPaper('A4');
        $pdf->render();

        return $pdf->output();
    }

    public static function xlsx(array $q): string
    {
        $book = new Spreadsheet;
        $book->getProperties()->setCreator('Chai & Associates')->setTitle($q['number']);
        $sheet = $book->getActiveSheet();
        $sheet->setTitle('Proforma')->setShowGridlines(false);
        $sheet->getColumnDimension('A')->setWidth(72);
        $sheet->getColumnDimension('B')->setWidth(20);
        $sheet->getColumnDimension('C')->setWidth(16);
        $row = 1;
        $add = function (array $values, bool $bold = false, bool $merged = false, int $size = 11) use ($sheet, &$row) {
            $n = $row++;
            foreach ($values as $k => $value) {
                $sheet->setCellValueExplicit([$k + 1, $n], $value, is_int($value) || is_float($value) ? DataType::TYPE_NUMERIC : DataType::TYPE_STRING);
            }if ($merged) {
                $sheet->mergeCells("A$n:C$n");
            }$sheet->getStyle("A$n:C$n")->getFont()->setName('Arial')->setSize($size)->setBold($bold);
            $sheet->getStyle("A$n:C$n")->getAlignment()->setWrapText(true)->setVertical('center');
            $sheet->getRowDimension($n)->setRowHeight(max(24, ceil(mb_strlen((string) ($values[0] ?? '')) / ($merged ? 95 : 65)) * 16));

            return $n;
        };
        $c = $q['calculation'];
        $i = $q['input'];
        $add(['CHAI & ASSOCIATES'], true, true, 18);
        foreach ($c['layout']['company_lines'] ?? [] as $line) {
            $add([$line], true, true, 10);
        }$add([$c['layout']['document_title'] ?? 'PROFORMA'], true, true, 15);
        foreach (['Quotation' => $i['ref_code'] ?? $q['number'], 'Client' => $i['client_name'], 'PIC' => $i['pic'] ?? '', 'Reference' => $i['reference'] ?? '', 'Date' => $i['quotation_date']] as $label => $v) {
            $add(["$label: $v"], false, true);
        }
        $headers = $add(['Description', 'Amount (RM)', 'SST applicable'], true);
        $sheet->getPageSetup()->setRowsToRepeatAtTop([$headers, $headers]);
        $section = '';
        foreach ($c['items'] as $item) {
            if ($item['hidden']) {
                continue;
            }if ($section !== $item['section_code']) {
                $section = $item['section_code'];
                $n = $add([$item['section_name']], true, true);
                $sheet->getStyle("A$n:C$n")->getFill()->setFillType('solid')->getStartColor()->setARGB('FFF2F2F2');
            }$n = $add([$item['description'], (float) $item['amount'], $item['sst_applicable'] ? 'Yes' : 'No']);
            $sheet->getStyle("B$n")->getNumberFormat()->setFormatCode('#,##0.00');
        }
        foreach (['Professional fees' => 'professional_fees', 'Disbursements' => 'disbursements', 'SST' => 'sst', 'Total payable' => 'total_payable', 'Total financing' => 'total_financing'] as $label => $key) {
            $n = $add([$label, (float) $c['summary'][$key]], true);
            $sheet->getStyle("B$n")->getNumberFormat()->setFormatCode('#,##0.00');
        }
        foreach ([$c['layout']['footer_note'] ?? '', ...($c['layout']['payment_lines'] ?? [])] as $line) {
            if ($line) {
                $add([$line], false, true, 10);
            }
        }
        $sheet->getPageSetup()->setPaperSize(9)->setFitToWidth(1)->setFitToHeight(0);
        $tmp = tempnam(sys_get_temp_dir(), 'chai-xlsx-');
        try {
            (new Xlsx($book))->save($tmp);

            return file_get_contents($tmp);
        } finally {
            unlink($tmp);
            $book->disconnectWorksheets();
        }
    }
}
