<?php

declare(strict_types=1);

namespace Chai;

use PDO;
use RuntimeException;

final class Store
{
    public PDO $db;

    public function __construct(?PDO $db = null)
    {
        $this->db = $db ?? new PDO('mysql:host='.(getenv('DB_HOST') ?: 'db').';dbname='.(getenv('DB_NAME') ?: 'chai').';charset=utf8mb4', getenv('DB_USER') ?: 'chai', getenv('DB_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
        // All application mutations and backups share a MySQL advisory lock across PHP workers.
        if ((int) $this->db->query("SELECT GET_LOCK('chai-workspace',30)")->fetchColumn() !== 1) {
            throw new RuntimeException('Workspace busy. Try again shortly.');
        }
        $this->db->exec('CREATE TABLE IF NOT EXISTS templates(id VARCHAR(100) PRIMARY KEY,code VARCHAR(100) NOT NULL,name VARCHAR(255) NOT NULL,version INT NOT NULL,body LONGTEXT NOT NULL,created_at VARCHAR(40) NOT NULL,UNIQUE(code,version)) ENGINE=InnoDB COLLATE=utf8mb4_bin');
        $this->db->exec('CREATE TABLE IF NOT EXISTS quotations(id VARCHAR(100) PRIMARY KEY,number VARCHAR(100) UNIQUE NOT NULL,client_name VARCHAR(255) NOT NULL,status VARCHAR(16) NOT NULL,revision INT NOT NULL,body LONGTEXT NOT NULL,created_at VARCHAR(40) NOT NULL,updated_at VARCHAR(40) NOT NULL, INDEX quotations_updated(updated_at)) ENGINE=InnoDB COLLATE=utf8mb4_bin');
        $this->db->exec('CREATE TABLE IF NOT EXISTS settings(name VARCHAR(100) PRIMARY KEY,value LONGTEXT NOT NULL) ENGINE=InnoDB COLLATE=utf8mb4_bin');
        if (! $this->setting('initialized', false)) {
            $this->transaction(function () {
                foreach (json_decode(file_get_contents(dirname(__DIR__).'/seed/templates.json'), true, 512, JSON_THROW_ON_ERROR) as $t) {
                    $this->insertTemplate(array_replace($t, ['version' => 1]));
                }
                $this->setSetting('initialized', true);
                $this->setSetting('autoBackup', true);
            });
        }
    }

    public function __destruct()
    {
        if (isset($this->db)) {
            $this->db->query("SELECT RELEASE_LOCK('chai-workspace')");
        }
    }

    public static function json(mixed $v): string
    {
        return json_encode($v, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 15) | 64);
        $b[8] = chr((ord($b[8]) & 63) | 128);
        $h = bin2hex($b);

        return substr($h, 0, 8).'-'.substr($h, 8, 4).'-'.substr($h, 12, 4).'-'.substr($h, 16, 4).'-'.substr($h, 20);
    }

    public static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s').'.'.substr(sprintf('%06d', (int) ((microtime(true) - floor(microtime(true))) * 1e6)), 0, 3).'Z';
    }

    public function query(string $sql, array $args = []): \PDOStatement
    {
        $s = $this->db->prepare($sql);
        $s->execute($args);

        return $s;
    }

    public function transaction(callable $fn): mixed
    {
        $this->db->beginTransaction();
        try {
            $r = $fn();
            $this->db->commit();

            return $r;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }throw $e;
        }
    }

    public function setting(string $name, mixed $fallback = null): mixed
    {
        $v = $this->query('SELECT value FROM settings WHERE name=?', [$name])->fetchColumn();

        return $v === false ? $fallback : json_decode($v, true, 512, JSON_THROW_ON_ERROR);
    }

    public function setSetting(string $name, mixed $value): void
    {
        $this->query('INSERT INTO settings(name,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=?', [$name, self::json($value), self::json($value)]);
    }

    public function insertTemplate(array $t): array
    {
        $t = array_replace(['status' => 'active', 'revision' => 1, 'effective_from' => '2026-04-01'], $t, ['id' => self::uuid()]);
        $this->query('INSERT INTO templates VALUES(?,?,?,?,?,?)', [$t['id'], $t['code'], $t['name'], $t['version'], self::json($t), self::now()]);

        return $t;
    }

    public function template(string $id): array
    {
        $s = $this->query('SELECT body FROM templates WHERE id=?', [$id])->fetchColumn();
        if ($s === false) {
            throw new RuntimeException('Template not found.');
        }

return json_decode($s, true, 512, JSON_THROW_ON_ERROR);
    }

    public function quote(string $id): array
    {
        $r = $this->query('SELECT * FROM quotations WHERE id=?', [$id])->fetch();
        if (! $r) {
            throw new RuntimeException('Quotation not found.');
        }

return array_replace(json_decode($r['body'], true, 512, JSON_THROW_ON_ERROR), ['id' => $r['id'], 'number' => $r['number'], 'revision' => (int) $r['revision'], 'created_at' => $r['created_at'], 'updated_at' => $r['updated_at']]);
    }

    public function rpc(string $method, array $args = []): mixed
    {
        if ($method === 'rules.simulate') {
            $a = Calculator::evaluate($args['rule'], $args['inputs']);

            return ['amount' => $a, 'steps' => [['description' => 'Structured rule result', 'amount' => $a]]];
        }
        if (in_array($method, ['templates.update', 'templates.draft', 'templates.activate', 'templates.delete', 'templates.impact'])) {
            return $this->templateOperation($method, $args);
        }
        switch ($method) {
            case 'templates.list':return array_map(fn ($r) => json_decode($r['body'], true, 512, JSON_THROW_ON_ERROR), $this->query('SELECT body FROM templates ORDER BY code,version DESC')->fetchAll());
            case 'templates.save':
                $t = $args['template'] ?? [];
                if (! trim($t['name'] ?? '') || mb_strlen($t['name']) > 255 || ! preg_match('/^[-a-z0-9]{3,100}$/D', $t['code'] ?? '')) {
                    throw new RuntimeException('Template name and valid code are required.');
                }
                Calculator::calculate($t, array_replace(self::sample(), $args['sample_inputs'] ?? []));

                return $this->transaction(function () use ($t) {
                    $v = (int) $this->query('SELECT MAX(version) FROM templates WHERE code=?', [$t['code']])->fetchColumn();
                    if ($v !== (int) ($t['version'] ?? 0)) {
                        throw new RuntimeException('A newer template version exists. Reload before saving.');
                    }

return $this->insertTemplate(['code' => $t['code'], 'name' => trim($t['name']), 'rules' => $t['rules'], 'catalog_sections' => $t['catalog_sections'] ?? [], 'version' => $v + 1]);
                });
            case 'quotations.list':return array_map(function ($r) {
                $b = json_decode($r['body'], true, 512, JSON_THROW_ON_ERROR);
                unset($r['body']);
                $c = $b['calculation'];
                $r['revision'] = (int) $r['revision'];

                return $r + ['total' => $c['summary']['total_payable'], 'template_name' => $c['template_snapshot']['name'], 'input' => $b['input'], 'calculation_summary' => $c['summary'], 'template_code' => $c['template_snapshot']['code']];
            }, $this->query('SELECT * FROM quotations ORDER BY updated_at DESC')->fetchAll());
            case 'quotations.get':return $this->quote($args['id']);
            case 'quotations.calculate':return Calculator::calculate(! empty($args['id']) ? $this->quote($args['id'])['calculation']['template_snapshot'] : $this->template($args['template_id']), $args['input']);
            case 'quotations.save':
                $input = $args['input'] ?? [];
                if (! trim($input['client_name'] ?? '') || mb_strlen($input['client_name']) > 255) {
                    throw new RuntimeException('Client name is required (maximum 255 characters).');
                }
                $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $input['quotation_date'] ?? '');
                if (! $date || $date->format('Y-m-d') !== $input['quotation_date']) {
                    throw new RuntimeException('Quotation date is required.');
                }if (! in_array($input['status'] ?? '', ['draft', 'issued'])) {
                    throw new RuntimeException('Invalid quotation status.');
                }

                return $this->transaction(function () use ($args, $input) {
                    $old = ! empty($args['id']) ? $this->quote($args['id']) : null;
                    if ($old && $old['revision'] !== ($args['revision'] ?? null)) {
                        throw new RuntimeException('This quotation was changed elsewhere. Reopen it before saving.');
                    }
                    $t = $old ? $old['calculation']['template_snapshot'] : $this->template($args['template_id']);
                    $c = Calculator::calculate($t, $input);
                    $id = $old['id'] ?? self::uuid();
                    $number = $old['number'] ?? ('CA-'.gmdate('Y').'-'.strtoupper(bin2hex(random_bytes(5))));
                    $now = self::now();
                    $revision = ($old['revision'] ?? 0) + 1;
                    $body = self::json(['input' => $input, 'calculation' => $c]);
                    if ($old) {
                        $this->query('UPDATE quotations SET client_name=?,status=?,revision=?,body=?,updated_at=? WHERE id=?', [trim($input['client_name']), $input['status'], $revision, $body, $now, $id]);
                    } else {
                        $this->query('INSERT INTO quotations VALUES(?,?,?,?,?,?,?,?)', [$id, $number, trim($input['client_name']), $input['status'], $revision, $body, $now, $now]);
                    }

return $this->quote($id);
                });
            case 'quotations.delete':return $this->transaction(function () use ($args) {
                $q = $this->quote($args['id']);
                if ($q['revision'] !== ($args['revision'] ?? null)) {
                    throw new RuntimeException('Quotation changed. Reopen it first.');
                }$this->query('DELETE FROM quotations WHERE id=?', [$q['id']]);

                return true;
            });
            default:throw new RuntimeException('Unsupported operation.');
        }
    }

    public static function sample(): array
    {
        return ['loan_amount' => 500000, 'ccm_search_amount' => 0, 'finance_legal_fee' => false, 'finance_insurance' => false];
    }

    private function putTemplate(array $t): void
    {
        $this->query('UPDATE templates SET name=?,body=? WHERE id=?', [$t['name'], self::json($t), $t['id']]);
    }

    private function templateOperation(string $method, array $args): mixed
    {
        $current = $this->template($args['id']);
        if ($method === 'templates.impact') {
            $a = Calculator::calculate($current, $args['inputs']);
            $b = Calculator::calculate(array_replace($current, ['rules' => $args['rules']]), $args['inputs']);
            $aa = array_column($a['items'], null, 'code');
            $bb = array_column($b['items'], null, 'code');
            $items = [];
            foreach (array_unique([...array_keys($aa), ...array_keys($bb)]) as $code) {
                $x = $aa[$code] ?? null;
                $y = $bb[$code] ?? null;
                $av = $x && ! $x['hidden'] ? $x['amount'] : 0;
                $bv = $y && ! $y['hidden'] ? $y['amount'] : 0;
                $items[] = ['code' => $code, 'description' => ($y ?? $x)['description'], 'status' => ! $x ? 'added' : (! $y ? 'removed' : ($av == $bv ? 'unchanged' : 'changed')), 'before' => $av, 'after' => $bv, 'delta' => Calculator::money($bv - $av)];
            }

            return ['baseline' => ['version' => $current['version']], 'candidate' => ['version' => $current['version']], 'before' => $a['summary'], 'after' => $b['summary'], 'total_delta' => Calculator::money($b['summary']['total_payable'] - $a['summary']['total_payable']), 'items' => $items];
        }

        return $this->transaction(function () use ($method, $args, $current) {
            if (($current['revision'] ?? 1) !== ($args['revision'] ?? null)) {
                throw new RuntimeException('Template changed. Reload before saving.');
            }
            if ($method === 'templates.update') {
                if (! trim($args['name'] ?? '') || mb_strlen($args['name']) > 255) {
                    throw new RuntimeException('Template name is required (maximum 255 characters).');
                }
                $t = array_replace($current, ['name' => trim($args['name']), 'rules' => $args['rules'], 'change_note' => $args['change_note'] ?? '', 'effective_from' => $args['effective_from'] ?? $current['effective_from'], 'revision' => ($current['revision'] ?? 1) + 1]);
                Calculator::calculate($t, self::sample());
                $this->putTemplate($t);

                return $t;
            }
            if ($method === 'templates.draft') {
                $v = (int) $this->query('SELECT MAX(version) FROM templates WHERE code=?', [$current['code']])->fetchColumn();

                return $this->insertTemplate(array_replace($current, ['version' => $v + 1, 'status' => 'draft', 'revision' => 1, 'change_note' => $args['change_note'] ?? '']));
            }
            if ($method === 'templates.activate') {
                $result = null;
                foreach ($this->rpc('templates.list') as $t) {
                    if ($t['code'] === $current['code']) {
                        $t['status'] = $t['id'] === $current['id'] ? 'active' : 'superseded';
                        $t['revision'] = ($t['revision'] ?? 1) + 1;
                        $this->putTemplate($t);
                        if ($t['id'] === $current['id']) {
                            $result = $t;
                        }
                    }
                }

return $result;
            }
            $this->query('DELETE FROM templates WHERE id=?', [$current['id']]);
            $siblings = array_values(array_filter($this->rpc('templates.list'), fn ($t) => $t['code'] === $current['code']));
            if ($siblings && ! array_filter($siblings,fn ($t) => $t['status'] === 'active')) {
                $t = $siblings[0];
                $t['status'] = 'active';
                $t['revision'] = ($t['revision'] ?? 1) + 1;
                $this->putTemplate($t);
            }

return true;
        });
    }
}
