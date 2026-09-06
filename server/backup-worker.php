<?php

use Chai\Data;
use Chai\Store;

require __DIR__.'/vendor/autoload.php';
while (true) {
    try {
        $store = new Store;
        $data = new Data($store);
        $data->daily();
        unset($data,$store);
    } catch (Throwable $e) {
        error_log('Automatic backup: '.$e->getMessage());
        unset($data,$store);
    }sleep(900);
}
