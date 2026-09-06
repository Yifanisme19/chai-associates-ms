<?php

declare(strict_types=1);
require dirname(__DIR__).'/vendor/autoload.php';
use Chai\Data;
use Chai\Exporter;
use Chai\Store;

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
// Accept literal IP addresses and localhost; keep cross-site and rebinding protection.
$host = $_SERVER['HTTP_HOST'] ?? '';
$hostname = parse_url('http://'.$host, PHP_URL_HOST);
$ip = is_string($hostname) ? trim($hostname, '[]') : '';
if (! is_string($hostname) || ($hostname !== 'localhost' && filter_var($ip, FILTER_VALIDATE_IP) === false)) {
    http_response_code(403);
    exit('Use localhost or an IP address.');
}
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_SERVER['HTTP_X_CHAI_REQUEST'] ?? '') !== '1' || ($origin !== '' && $origin !== 'http://'.$host && $origin !== 'https://'.$host)) {
    http_response_code(403);
    exit('Invalid request origin.');
}
try {
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 5 * 1024 * 1024) {
        throw new RuntimeException('Request too large.');
    }
    $request = json_decode(file_get_contents('php://input'), true, 128, JSON_THROW_ON_ERROR);
    if (! is_array($request)) {
        throw new RuntimeException('Invalid request.');
    }$method = $request['method'] ?? '';
    $args = $request['args'] ?? [];
    if (! is_string($method) || ! is_array($args)) {
        throw new RuntimeException('Invalid request.');
    }
    $store = new Store;
    $data = new Data($store);
    if ($method === 'settings') {
        $result = $data->settings();
    } elseif ($method === 'data-options') {
        if (! is_bool($args['enabled'] ?? null)) {
            throw new RuntimeException('Invalid backup setting.');
        }$store->setSetting('autoBackup', $args['enabled']);
        if ($args['enabled']) {
            $data->daily();
        }$result = $data->settings();
    } elseif ($method === 'backup') {
        $name = $data->backup();
        $result = ['file' => $name, 'settings' => $data->settings()];
    } elseif ($method === 'prepare-restore') {
        $name = $args['name'] ?? '';
        $file = $data->backupPath($name);
        $result = $data->prepare(Data::validate(json_decode(file_get_contents($file), true, 128, JSON_THROW_ON_ERROR)), $name);
    } elseif ($method === 'cancel-restore') {
        $result = $data->cancel($args['token']);
    } elseif ($method === 'restore') {
        $result = $data->apply($args['token'], 'restore');
    } elseif ($method === 'check-data') {
        $data->snapshot();
        foreach (['templates', 'quotations'] as $table) {
            $rows = $store->query('CHECK TABLE '.$table)->fetchAll();
            foreach ($rows as $row) {
                if ($row['Msg_type'] === 'error') {
                    throw new RuntimeException('MySQL integrity check failed.');
                }
            }
        }$result = ['checkedAt' => Store::now(), 'settings' => $data->settings()];
    } elseif ($method === 'export') {
        $q = $store->quote($args['id']);
        $format = $args['format'] ?? '';
        if (! in_array($format, ['pdf', 'xlsx'])) {
            throw new RuntimeException('Unsupported export format.');
        }$content = $format === 'pdf' ? Exporter::pdf($q) : Exporter::xlsx($q);
        $name = preg_replace('/[^A-Za-z0-9_-]/', '_', $q['number']).'.'.$format;
        header('Content-Type: '.($format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        header('Content-Disposition: attachment; filename="'.$name.'"');
        echo $content;
        exit;
    } else {
        $result = $store->rpc($method, $args);
    }
    header('Content-Type: application/json');
    echo Store::json(['result' => $result]);
} catch (Throwable $e) {
    $unexpected = $e instanceof PDOException || $e instanceof TypeError || $e instanceof Error;
    if ($unexpected) {
        error_log((string) $e);
    }
    http_response_code($unexpected ? 500 : 422);
    header('Content-Type: application/json');
    echo json_encode(['error' => $unexpected ? 'The operation failed. Current data was not changed; check the service logs.' : $e->getMessage()]);
}
