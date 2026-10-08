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
 * Laravel alles Neue per Migration an, and a fresh production database is built by these
 * migrations alone (api/docker/entrypoint.sh runs `migrate`). Sie braucht dieselben Tabellen,
 * die in Entwicklung und Docker laengst stehen.
 *
 * Deshalb legt diese Migration NUR an, was fehlt - Tabelle fuer Tabelle, Spalte
 * fuer Spalte. Gegen eine bestehende Datenbank ist sie ein Nichtstuer; gegen eine
 * leere baut sie den Stand von schema.sql nach, with the same names, types and column order
 * (scripts/schema-drift compares them), ohne die Tabellen der entfernten Funktionen
 * (Beitraege, Storys, Praemien, Folgen, Freunde, Abos) - except `activities`, which stays
 * empty because the chat tables keep their foreign keys to it.
 *
 * The API tests run on MySQL loaded from server/schema.sql (tests/AppFeatureTestCase.php).
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->addMissingUserColumns();

        if (! Schema::hasTable('personal_access_tokens')) {
            Schema::create('personal_access_tokens', function (Blueprint $table) {
                $table->id();
                $table->morphs('tokenable', 'personal_access_tokens_tokenable_idx');
                $table->text('name');
                $table->string('token', 64)->unique();
                $table->text('abilities')->nullable();
                $table->timestamp('last_used_at')->nullable();
                $table->timestamp('expires_at')->nullable()->index('personal_access_tokens_expires_at_idx');
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('two_factor_challenges')) {
            Schema::create('two_factor_challenges', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users', 'id', 'two_factor_challenges_user_fk')->cascadeOnDelete();
                $table->char('token_hash', 64)->unique('two_factor_challenges_token_uq');
                $table->string('method', 10)->nullable();
                $table->char('code_hash', 64)->nullable();
                $table->string('purpose', 10);
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->dateTime('expires_at')->index('two_factor_challenges_expires_idx');
                $table->timestamp('created_at')->nullable();
                $table->dateTime('last_sent_at')->nullable();
                $table->index(['user_id', 'purpose'], 'two_factor_challenges_user_idx');
            });
        }

        /*
         * The events of the removed event feature: no route reads or writes them any more, but
         * chat_rooms.activity_id and chat_messages.shared_activity_id keep their foreign keys to
         * this table as in server/schema.sql (scripts/schema-drift compares both), so the table
         * stands, empty, in a fresh database.
         */
        if (! Schema::hasTable('activities')) {
            Schema::create('activities', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users', 'id', 'activities_user_id_fk')->cascadeOnDelete();
                $table->string('title');
                $table->text('description');
                $table->string('location');
                $table->dateTime('starts_at');
                $table->string('banner_path')->nullable();
                $table->unsignedInteger('max_participants')->nullable();
                $table->dateTime('boosted_until')->nullable();
                $table->boolean('is_permanent')->default(false);
                $table->timestamps();
                $table->index('user_id', 'activities_user_id_idx');
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

        // Index and foreign-key names below are the ones in server/schema.sql, so a fresh database
        // gets the same schema as the reference (scripts/schema-drift checks it).
        if (! Schema::hasTable('interest_user')) {
            Schema::create('interest_user', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users', 'id', 'interest_user_user_id_fk')->cascadeOnDelete();
                $table->foreignId('interest_id')->constrained('interests', 'id', 'interest_user_interest_id_fk')->cascadeOnDelete();
                $table->timestamps();
                $table->unique(['user_id', 'interest_id'], 'interest_user_unique');
                $table->index('interest_id', 'interest_user_interest_id_idx');
            });
        }

        if (! Schema::hasTable('friend_groups')) {
            Schema::create('friend_groups', function (Blueprint $table) {
                $table->id();
                $table->foreignId('owner_id')->constrained('users', 'id', 'friend_groups_owner_fk')->cascadeOnDelete();
                $table->string('name', 60);
                $table->string('description', 200)->nullable();
                $table->timestamps();
                $table->index('owner_id', 'friend_groups_owner_idx');
            });
        }

        if (! Schema::hasTable('group_members')) {
            Schema::create('group_members', function (Blueprint $table) {
                $table->foreignId('group_id')->constrained('friend_groups', 'id', 'group_members_group_fk')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained('users', 'id', 'group_members_user_fk')->cascadeOnDelete();
                $table->timestamp('created_at')->nullable();
                $table->primary(['group_id', 'user_id']);
                $table->index('user_id', 'group_members_user_id_idx');
            });
        }

        if (! Schema::hasTable('chat_rooms')) {
            Schema::create('chat_rooms', function (Blueprint $table) {
                $table->id();
                $table->string('kind', 10);
                $table->foreignId('group_id')->nullable()->unique('chat_rooms_group_uq')->constrained('friend_groups', 'id', 'chat_rooms_group_fk')->cascadeOnDelete();
                $table->foreignId('activity_id')->nullable()->unique('chat_rooms_activity_uq')->constrained('activities', 'id', 'chat_rooms_activity_fk')->cascadeOnDelete();
                $table->timestamp('created_at')->nullable();
            });
        }

        if (! Schema::hasTable('chat_messages')) {
            Schema::create('chat_messages', function (Blueprint $table) {
                $table->id();
                $table->foreignId('room_id')->constrained('chat_rooms', 'id', 'chat_messages_room_fk')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained('users', 'id', 'chat_messages_user_fk')->cascadeOnDelete();
                $table->string('body', 1000)->default('');
                $table->foreignId('shared_activity_id')->nullable()->constrained('activities', 'id', 'chat_messages_shared_activity_fk')->nullOnDelete();
                $table->string('shared_title')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->index(['room_id', 'id'], 'chat_messages_room_idx');
                $table->index('user_id', 'chat_messages_user_id_idx');
            });
        }

        if (! Schema::hasTable('chat_reads')) {
            Schema::create('chat_reads', function (Blueprint $table) {
                $table->foreignId('room_id')->constrained('chat_rooms', 'id', 'chat_reads_room_fk')->cascadeOnDelete();
                $table->foreignId('user_id')->constrained('users', 'id', 'chat_reads_user_fk')->cascadeOnDelete();
                $table->unsignedBigInteger('last_read_id')->default(0);
                $table->timestamp('updated_at')->nullable();
                $table->primary(['room_id', 'user_id']);
                $table->index('user_id', 'chat_reads_user_id_idx');
            });
        }

        if (! Schema::hasTable('user_blocks')) {
            Schema::create('user_blocks', function (Blueprint $table) {
                $table->foreignId('blocker_id')->constrained('users', 'id', 'user_blocks_blocker_fk')->cascadeOnDelete();
                $table->foreignId('blocked_id')->constrained('users', 'id', 'user_blocks_blocked_fk')->cascadeOnDelete();
                $table->timestamp('created_at')->nullable();
                $table->primary(['blocker_id', 'blocked_id']);
                $table->index('blocked_id', 'user_blocks_blocked_idx');
            });
        }

        if (! Schema::hasTable('content_reports')) {
            Schema::create('content_reports', function (Blueprint $table) {
                $table->id();
                $table->foreignId('reporter_id')->nullable()->constrained('users', 'id', 'content_reports_reporter_fk')->nullOnDelete();
                $table->string('target_type', 20);
                $table->unsignedBigInteger('target_id');
                $table->string('reason', 30);
                $table->string('note', 500)->nullable();
                $table->enum('status', ['open', 'reviewed', 'dismissed'])->default('open');
                $table->foreignId('handled_by')->nullable()->constrained('users', 'id', 'content_reports_admin_fk')->nullOnDelete();
                $table->dateTime('handled_at')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->unique(['reporter_id', 'target_type', 'target_id'], 'content_reports_once_uq');
                $table->index(['status', 'created_at'], 'content_reports_status_idx');
                $table->index(['target_type', 'target_id'], 'content_reports_target_idx');
            });
        }

        if (! Schema::hasTable('ban_evidence')) {
            Schema::create('ban_evidence', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users', 'id', 'ban_evidence_user_id_fk')->cascadeOnDelete();
                $table->foreignId('admin_id')->nullable()->constrained('users', 'id', 'ban_evidence_admin_id_fk')->nullOnDelete();
                $table->string('source', 10)->default('admin');
                $table->string('action', 20);
                $table->string('reason');
                $table->dateTime('banned_until')->nullable();
                $table->string('image_path')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->index('user_id', 'ban_evidence_user_id_idx');
            });
        }
    }

    /**
     * Die Spalten, die schema.sql an `users` haengt, Laravels Grundtabelle aber
     * nicht kennt.
     */
    private function addMissingUserColumns(): void
    {
        // Each column at its place in server/schema.sql (`after`), so a fresh database has the
        // reference's column order; the minimum-age columns follow in their own migration.
        $columns = [
            'username' => fn (Blueprint $t) => $t->string('username')->nullable()->unique()->after('name'),
            'account_type' => fn (Blueprint $t) => $t->string('account_type')->nullable()->after('username'),
            'granted_account_type' => fn (Blueprint $t) => $t->string('granted_account_type')->nullable()->after('account_type'),
            'google_id' => fn (Blueprint $t) => $t->string('google_id')->nullable()->unique()->after('granted_account_type'),
            'avatar' => fn (Blueprint $t) => $t->string('avatar')->nullable()->after('google_id'),
            'banner' => fn (Blueprint $t) => $t->string('banner')->nullable()->after('avatar'),
            'is_admin' => fn (Blueprint $t) => $t->boolean('is_admin')->default(false)->after('password'),
            'banned_until' => fn (Blueprint $t) => $t->dateTime('banned_until')->nullable()->after('is_admin'),
            'ban_reason' => fn (Blueprint $t) => $t->string('ban_reason')->nullable()->after('banned_until'),
            'terms_version' => fn (Blueprint $t) => $t->string('terms_version', 20)->nullable()->after('ban_reason'),
            'terms_accepted_at' => fn (Blueprint $t) => $t->dateTime('terms_accepted_at')->nullable()->after('terms_version'),
            'two_factor_method' => fn (Blueprint $t) => $t->string('two_factor_method', 10)->nullable()->after('terms_accepted_at'),
            'two_factor_secret' => fn (Blueprint $t) => $t->text('two_factor_secret')->nullable()->after('two_factor_method'),
            'two_factor_recovery_codes' => fn (Blueprint $t) => $t->text('two_factor_recovery_codes')->nullable()->after('two_factor_secret'),
            'two_factor_confirmed_at' => fn (Blueprint $t) => $t->dateTime('two_factor_confirmed_at')->nullable()->after('two_factor_recovery_codes'),
            'two_factor_last_step' => fn (Blueprint $t) => $t->bigInteger('two_factor_last_step')->nullable()->after('two_factor_confirmed_at'),
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
