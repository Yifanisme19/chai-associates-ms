<?php

declare(strict_types=1);
require dirname(__DIR__).'/vendor/autoload.php';
use Chai\Calculator;
use Chai\Data;
use Chai\Exporter;
use Chai\Store;
use PhpOffice\PhpSpreadsheet\IOFactory;

function check(bool $ok, string $message): void
{
    if (! $ok) {
        throw new RuntimeException($message);
    }
}
function rejects(callable $fn, string $pattern = ''): void
{
    try {
        $fn();
    } catch (Throwable $e) {
        if ($pattern && ! str_contains($e->getMessage(), $pattern)) {
            throw $e;
        }

return;
    }throw new RuntimeException('Expected rejection.');
}
$passed = 0;
function test(string $name, callable $fn): void
{
    global $passed;
    $fn();
    $passed++;
    echo "PASS $name\n";
}
$seeds = json_decode(file_get_contents((is_file(dirname(__DIR__).'/seed/templates.json') ? dirname(__DIR__) : dirname(__DIR__, 2)).'/seed/templates.json'), true);
$input = ['client_name' => 'PHP Test client', 'quotation_date' => '2026-09-06', 'status' => 'draft', 'loan_amount' => 500000, 'ccm_search_amount' => 0, 'finance_legal_fee' => false, 'finance_insurance' => false];
foreach (json_decode(file_get_contents(__DIR__.'/parity.json'), true) as $fixture) {
    test('Parity '.$fixture['code'].' @ '.$fixture['input']['loan_amount'], function () use ($seeds, $fixture) {
        $t = array_values(array_filter($seeds, fn ($s) => $s['code'] === $fixture['code']))[0];
        $t += ['id' => 'seed', 'version' => 1];
        $c = Calculator::calculate($t, $fixture['input']);
        check($c['summary'] == $fixture['summary'], 'Summary differs from original calculation.');
        $actual = array_map(fn ($i) => array_intersect_key($i, array_flip(['code', 'amount', 'sst_applicable'])), $c['items']);
        $expected = $fixture['items'];
        usort($actual, fn ($a, $b) => strcmp($a['code'], $b['code']));
        usort($expected, fn ($a, $b) => strcmp($a['code'], $b['code']));
        check($actual == $expected, 'Fee lines differ from original calculation.');
    });
}
test('Rule methods and validation', function () use ($seeds, $input) {
    foreach ([-1, NAN, INF, '', null, true] as $n) {
        rejects(fn () => Calculator::calculate($seeds[0], array_replace($input, ['loan_amount' => $n])));
    }check(Calculator::evaluate(['method' => 'per_unit', 'basis' => 'n', 'unit_size' => 1000, 'amount' => 3], ['n' => 1001]) == 6, 'per-unit');
    check(Calculator::evaluate(['method' => 'first_additional', 'basis' => 'n', 'amount' => 500, 'additional_amount' => 100], ['n' => 3]) == 700, 'first additional');
    check(Calculator::evaluate(['method' => 'banded', 'basis' => 'n', 'bands' => [['up_to' => 5, 'amount' => 1], ['up_to' => null, 'amount' => 2]]], ['n' => 6]) == 2, 'banded');
    check(Calculator::evaluate(['method' => 'conditional', 'cases' => [['when' => ['kind' => 'a'], 'rule' => ['method' => 'fixed', 'amount' => 7]]]], ['kind' => 'a']) == 7, 'conditional');
    $t = $seeds[1];
    $t['rules']['sections'][0]['items'][0]['input_bindings'] = ['x' => 'item:missing'];
    rejects(fn () => Calculator::calculate($t, $input), 'circular');
    rejects(fn () => Calculator::evaluate(['method' => 'tiered', 'basis' => 'n', 'tiers' => [['up_to' => 5, 'rate' => 0.1]]], ['n' => 6]), 'cover');
});
test('Protected amounts, hidden taxable lines and custom fees', function () use ($seeds, $input) {
    $t = $seeds[0] + ['id' => 'seed', 'version' => 1];
    $r = Calculator::calculate($t, $input);
    $fee = $r['items'][0];
    $c = Calculator::calculate($t, array_replace($input, ['line_overrides' => [array_replace($fee, ['amount' => 1, 'amount_overridden' => true, 'hidden' => true]), ['code' => 'custom_test', 'description' => 'Additional', 'amount' => 100, 'category' => 'professional', 'sst_applicable' => true]]]));
    $items = array_column($c['items'], null, 'code');
    check($items[$fee['code']]['amount'] == 6250, 'Protected amount');
    check($c['summary']['professional_fees'] == $r['summary']['professional_fees'] - 6250 + 100, 'Hidden total');
    check($c['summary']['sst'] == $r['summary']['sst'] - 500 + 8, 'Hidden tax');
});
if (getenv('DB_NAME') !== 'chai_test') {
    echo "$passed calculation tests passed. Set DB_NAME=chai_test for database tests.\n";
    exit;
}
$store = new Store;
$data = new Data($store, sys_get_temp_dir().'/chai-php-test-'.bin2hex(random_bytes(6)));
$t = $store->rpc('templates.list')[0];
$q = null;
test('Fresh database: four templates and no accounts or quotations', function () use ($store) {
    check(count($store->rpc('templates.list')) === 4, 'Four seeds');
    check($store->rpc('quotations.list') === [], 'No migrated quotations');
    $tables = $store->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    sort($tables);
    check($tables === ['quotations', 'settings', 'templates'], 'Only local tool tables');
});
test('Save, reopen, update, stale edit and delete checks', function () use ($store, $t, $input, &$q) {
    $q = $store->rpc('quotations.save', ['template_id' => $t['id'], 'input' => $input]);
    check($store->quote($q['id']) == $q, 'Reopen');
    $q = $store->rpc('quotations.save', ['id' => $q['id'], 'revision' => 1, 'input' => array_replace($input, ['client_name' => 'Updated client'])]);
    check($q['revision'] === 2, 'Revision');
    rejects(fn () => $store->rpc('quotations.save', ['id' => $q['id'], 'revision' => 1, 'input' => $input]), 'changed');
    rejects(fn () => $store->rpc('quotations.delete', ['id' => $q['id'], 'revision' => 1]), 'changed');
});
test('Template draft, update, activate, simulate, impact and frozen quote snapshot', function () use ($store, $q, $t, $input) {
    $draft = $store->rpc('templates.draft', ['id' => $t['id'], 'revision' => $t['revision']]);
    $rules = $draft['rules'];
    $rules['sst_rate'] = 0.09;
    $updated = $store->rpc('templates.update', ['id' => $draft['id'], 'revision' => 1, 'name' => 'PHP Draft', 'rules' => $rules]);
    check($updated['revision'] === 2, 'Template revision');
    rejects(fn () => $store->rpc('templates.update', ['id' => $draft['id'], 'revision' => 1, 'name' => 'stale', 'rules' => $rules]), 'changed');
    $active = $store->rpc('templates.activate', ['id' => $updated['id'], 'revision' => 2]);
    check($active['status'] === 'active', 'Activate');
    $impact = $store->rpc('templates.impact', ['id' => $t['id'], 'inputs' => $input, 'rules' => $rules]);
    check($impact['total_delta'] >= 0, 'Impact');
    check($store->rpc('rules.simulate', ['rule' => ['method' => 'fixed', 'amount' => 123], 'inputs' => []])['amount'] == 123, 'Simulate');
    check($store->quote($q['id'])['calculation'] === $q['calculation'], 'Frozen snapshot');
    $store->rpc('templates.delete', ['id' => $active['id'], 'revision' => $active['revision']]);
});
test('PDF and XLSX exports use the saved snapshot and safe string cells', function () use ($q) {
    $q['input']['client_name'] = '=HYPERLINK("https://example.invalid")';
    $pdf = Exporter::pdf($q);
    check(str_starts_with($pdf, '%PDF-'), 'PDF');
    $xlsx = Exporter::xlsx($q);
    check(str_starts_with($xlsx, 'PK'), 'XLSX');
    $f = tempnam(sys_get_temp_dir(), 'xlsx');
    file_put_contents($f, $xlsx);
    $book = IOFactory::load($f);
    $found = false;
    foreach ($book->getActiveSheet()->getRowIterator() as $row) {
        foreach ($row->getCellIterator() as $cell) {
            check($cell->getDataType() !== 'f', 'No injected formula');
            if (str_contains((string) $cell->getValue(), 'HYPERLINK')) {
                $found = true;
            }
        }
    }check($found, 'Client exported');
    unlink($f);
});
test('Backup, restore preview, stale preview refusal and safety recovery', function () use ($store, $data, $q) {
    $name = $data->backup();
    $before = $data->snapshot();
    $preview = $data->prepare($before, $name);
    $store->rpc('quotations.delete', ['id' => $q['id'], 'revision' => $q['revision']]);
    rejects(fn () => $data->apply($preview['token'], 'restore'), 'changed');
    $preview = $data->prepare($before, $name);
    $r = $data->apply($preview['token'], 'restore');
    check($store->quote($q['id'])['number'] === $q['number'], 'Restored quote');
    check(is_file($data->backupPath($r['safetyBackup'])), 'Safety backup retained');
    rejects(fn () => $data->apply($preview['token'], 'restore'), 'expired');
    rejects(fn () => $data->backupPath('../.env'), 'not found');
    $bad = $before;
    $bad['quotations'][0]['body'] = '{}';
    rejects(fn () => Data::validate($bad));
});
test('Failed restore transaction leaves current data unchanged', function () use ($store, $data) {
    $before = $data->snapshot();
    $store->query("ALTER TABLE quotations ADD CONSTRAINT fail_restore CHECK (client_name <> 'Rejected restore client')");
    $bad = $before;
    $body = json_decode($bad['quotations'][0]['body'], true);
    $body['input']['client_name'] = 'Rejected restore client';
    $bad['quotations'][0]['client_name'] = 'Rejected restore client';
    $bad['quotations'][0]['body'] = Store::json($body);
    try {
        rejects(fn () => $data->restoreSnapshot($bad), 'fail_restore');
        check($data->snapshot()['quotations'] === $before['quotations'], 'Quotation rollback');
        check($data->snapshot()['templates'] === $before['templates'], 'Template rollback');
    } finally {
        $store->query('ALTER TABLE quotations DROP CHECK fail_restore');
    }
});
test('Automatic backup once daily, retention and disabled setting', function () use ($store, $data) {
    $data->daily();
    $count = count($data->backups());
    $data->daily();
    check(count($data->backups()) === $count, 'Once daily');
    for ($i = 1; $i <= 16; $i++) {
        $p = $data->directory.'/chai-auto-'.gmdate('Y-m-d', time() - $i * 86400).'-00000000.json';
        file_put_contents($p, '{}');
        touch($p, time() - $i * 86400);
    }$data->daily();
    check(count(array_filter($data->backups(),fn ($b) => $b['kind'] === 'automatic')) === 14,'Retention');
    $store->setSetting('autoBackup',false);
    $count = count($data->backups());
    $data->daily();
    check(count($data->backups()) === $count,'Disabled');
});
foreach (glob($data->directory.'/*') as $f) {
    unlink($f);
}rmdir($data->directory);
echo "$passed tests passed.\n";
