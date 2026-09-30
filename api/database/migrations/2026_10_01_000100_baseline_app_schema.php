<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Der Grundbestand der App-Datenbank - so, wie server/schema.sql ihn anlegt.
 *
 * ## Wozu, wenn es schema.sql gibt
 *
 * Bis zum Marktplatz-Umbau gehoerte das Schema dem Node-Backend. Seitdem legt
 * Laravel alles Neue per Migration an, und Laravels Tests laufen gegen eine leere
 * sqlite-Datenbank. Die braucht dieselben Tabellen, die in Entwicklung und Docker
 * laengst stehen.
 *
 * Deshalb legt diese Migration NUR an, was fehlt - Tabelle fuer Tabelle, Spalte
 * fuer Spalte. Gegen eine bestehende Datenbank ist sie ein Nichtstuer; gegen eine
 * leere baut sie den Stand von schema.sql nach (ohne die Tabellen der entfernten
 * Funktionen: Aktivitaeten, Beitraege, Storys, Praemien, Folgen, Freunde, Abos).
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->addMissingUserColumns();

        if (! Schema::hasTable('personal_access_tokens')) {
            Schema::create('personal_access_tokens', function (Blueprint $table) {
                $table->id();
                $table->morphs('tokenable');
                $table->text('name');
                $table->string('token', 64)->unique();
                $table->text('abilities')->nullable();
                $table->timestamp('last_used_at')->nullable();
                $table->timestamp('expires_at')->nullable()->index();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('two_factor_challenges')) {
            Schema::create('two_factor_challenges', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->char('token_hash', 64)->unique();
                $table->string('method', 10)->nullable();
                $table->char('code_hash', 64)->nullable();
                $table->string('purpose', 10);
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->dateTime('expires_at')->index();
                $table->timestamp('created_at')->nullable();
                $table->dateTime('last_sent_at')->nullable();
                $table->index(['user_id', 'purpose']);
            });
        }

        if (! Schema::hasTable('interests')) {
            Schema::create('interests', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->unique();
                $table->string('icon')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('interest_user')) {
            Schema::create('interest_user', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('interest_id')->constrained()->cascadeOnDelete();
                $table->timestamps();
                $table->unique(['user_id', 'interest_id']);
            });
        }

        if (! Schema::hasTable('friend_groups')) {
            Schema::create('friend_groups', function (Blueprint $table) {
                $table->id();
                $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
                $table->string('name', 60);
                $table->string('description', 200)->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('group_members')) {
            Schema::create('group_members', function (Blueprint $table) {
                $table->foreignId('group_id')->constrained('friend_groups')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->timestamp('created_at')->nullable();
                $table->primary(['group_id', 'user_id']);
            });
        }

        if (! Schema::hasTable('chat_rooms')) {
            Schema::create('chat_rooms', function (Blueprint $table) {
                $table->id();
                $table->string('kind', 10);
                $table->foreignId('group_id')->nullable()->unique()->constrained('friend_groups')->cascadeOnDelete();
                // In MySQL zeigt die Spalte auf `activities`; die Tabelle gibt es in
                // einer frischen Datenbank nicht mehr, also ohne Fremdschluessel.
                $table->unsignedBigInteger('activity_id')->nullable()->unique();
                $table->timestamp('created_at')->nullable();
            });
        }

        if (! Schema::hasTable('chat_messages')) {
            Schema::create('chat_messages', function (Blueprint $table) {
                $table->id();
                $table->foreignId('room_id')->constrained('chat_rooms')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('body', 1000)->default('');
                $table->unsignedBigInteger('shared_activity_id')->nullable();
                $table->string('shared_title')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->index(['room_id', 'id']);
            });
        }

        if (! Schema::hasTable('chat_reads')) {
            Schema::create('chat_reads', function (Blueprint $table) {
                $table->foreignId('room_id')->constrained('chat_rooms')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->unsignedBigInteger('last_read_id')->default(0);
                $table->timestamp('updated_at')->nullable();
                $table->primary(['room_id', 'user_id']);
            });
        }

        if (! Schema::hasTable('user_blocks')) {
            Schema::create('user_blocks', function (Blueprint $table) {
                $table->foreignId('blocker_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('blocked_id')->constrained('users')->cascadeOnDelete();
                $table->timestamp('created_at')->nullable();
                $table->primary(['blocker_id', 'blocked_id']);
            });
        }

        if (! Schema::hasTable('content_reports')) {
            Schema::create('content_reports', function (Blueprint $table) {
                $table->id();
                $table->foreignId('reporter_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('target_type', 20);
                $table->unsignedBigInteger('target_id');
                $table->string('reason', 30);
                $table->string('note', 500)->nullable();
                $table->string('status', 10)->default('open');
                $table->foreignId('handled_by')->nullable()->constrained('users')->nullOnDelete();
                $table->dateTime('handled_at')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->unique(['reporter_id', 'target_type', 'target_id']);
                $table->index(['status', 'created_at']);
            });
        }

        if (! Schema::hasTable('ban_evidence')) {
            Schema::create('ban_evidence', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('admin_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('source', 10)->default('admin');
                $table->string('action', 20);
                $table->string('reason');
                $table->dateTime('banned_until')->nullable();
                $table->string('image_path')->nullable();
                $table->timestamp('created_at')->nullable();
            });
        }
    }

    /**
     * Die Spalten, die schema.sql an `users` haengt, Laravels Grundtabelle aber
     * nicht kennt.
     */
    private function addMissingUserColumns(): void
    {
        $columns = [
            'username' => fn (Blueprint $t) => $t->string('username')->nullable()->unique(),
            'account_type' => fn (Blueprint $t) => $t->string('account_type')->nullable(),
            'granted_account_type' => fn (Blueprint $t) => $t->string('granted_account_type')->nullable(),
            'google_id' => fn (Blueprint $t) => $t->string('google_id')->nullable()->unique(),
            'avatar' => fn (Blueprint $t) => $t->string('avatar')->nullable(),
            'banner' => fn (Blueprint $t) => $t->string('banner')->nullable(),
            'is_admin' => fn (Blueprint $t) => $t->boolean('is_admin')->default(false),
            'banned_until' => fn (Blueprint $t) => $t->dateTime('banned_until')->nullable(),
            'ban_reason' => fn (Blueprint $t) => $t->string('ban_reason')->nullable(),
            'terms_version' => fn (Blueprint $t) => $t->string('terms_version', 20)->nullable(),
            'terms_accepted_at' => fn (Blueprint $t) => $t->dateTime('terms_accepted_at')->nullable(),
            'two_factor_method' => fn (Blueprint $t) => $t->string('two_factor_method', 10)->nullable(),
            'two_factor_secret' => fn (Blueprint $t) => $t->text('two_factor_secret')->nullable(),
            'two_factor_recovery_codes' => fn (Blueprint $t) => $t->text('two_factor_recovery_codes')->nullable(),
            'two_factor_confirmed_at' => fn (Blueprint $t) => $t->dateTime('two_factor_confirmed_at')->nullable(),
            'two_factor_last_step' => fn (Blueprint $t) => $t->bigInteger('two_factor_last_step')->nullable(),
        ];

        foreach ($columns as $name => $define) {
            if (! Schema::hasColumn('users', $name)) {
                Schema::table('users', fn (Blueprint $table) => $define($table));
            }
        }
    }

    public function down(): void
    {
        // Bewusst leer: Diese Migration legt nur nach, was schema.sql ohnehin
        // anlegt. Ein Zurueckrollen darf in einer bestehenden Datenbank nichts
        // loeschen, was es vorher schon gab.
    }
};
