<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The minimum-age confirmation at sign-up (F-14): which minimum age was confirmed, and when.
 *
 * server/schema.sql is the reference for the users table; this migration keeps the Laravel copy
 * of the table in step, with the same types and the same position (right after
 * terms_accepted_at, before the two-factor columns, as in schema.sql), so the schema drift check
 * (scripts/schema-drift) finds no new difference. On a database that has the columns already (one
 * loaded from server/schema.sql) it changes nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'min_age_confirmed')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->unsignedTinyInteger('min_age_confirmed')->nullable()->after('terms_accepted_at');
            $table->dateTime('min_age_confirmed_at')->nullable()->after('min_age_confirmed');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['min_age_confirmed', 'min_age_confirmed_at']);
        });
    }
};
