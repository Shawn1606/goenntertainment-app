<?php

namespace Tests\Probes;

use Tests\AppFeatureTestCase;

/**
 * Not part of any test suite (phpunit.xml lists tests/Unit and tests/Feature only). The tests
 * of AppFeatureTestCase run this file in a child PHPUnit process with a chosen database setup and
 * read the outcome: it shows what any database feature test gets in that setup.
 */
class AppSchemaProbe extends AppFeatureTestCase
{
    public function test_reaches_the_test_body(): void
    {
        $this->assertTrue(true);
    }
}
