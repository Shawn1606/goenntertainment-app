<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The minimum-age confirmation at sign-up (F-14): which minimum age was confirmed, and when.
 *
 * server/schema.sql owns the users table (and server/src/db.js adds the columns on existing
 * databases); this migration keeps the Laravel copy of the table in step, with the same types and
 * the same position (after the password, before remember_token, as in schema.sql), so the schema
 * drift check (scripts/schema-drift) finds no new difference.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedTinyInteger('min_age_confirmed')->nullable()->after('password');
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
