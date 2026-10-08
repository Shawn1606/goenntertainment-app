<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gruppen ohne Freundesliste.
 *
 * Bisher durfte man nur bestaetigte Freunde in eine Gruppe holen. Freunde gibt es
 * nicht mehr - wer mit will, tritt ueber einen Einladungscode bei (per Link oder
 * abgetippt). Jede Gruppe bekommt ihren Code; bestehende Gruppen werden hier
 * nachgeruestet.
 *
 * Dazu: Im Gruppen-Chat laesst sich ein Angebot teilen („Wollen wir das
 * machen?"). `shared_title` gibt es schon als Schnappschuss.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('friend_groups', function (Blueprint $table) {
            $table->string('invite_code', 12)->nullable()->unique();
        });

        foreach (DB::table('friend_groups')->whereNull('invite_code')->pluck('id') as $id) {
            DB::table('friend_groups')->where('id', $id)->update(['invite_code' => self::code()]);
        }

        Schema::table('chat_messages', function (Blueprint $table) {
            $table->foreignId('shared_offer_id')->nullable()->constrained('offers')->nullOnDelete();
        });
    }

    /** Gleiches Alphabet wie App\Support\Codes - ohne 0/O und 1/I. */
    private static function code(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        for ($i = 0; $i < 8; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return $code;
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('shared_offer_id');
        });
        Schema::table('friend_groups', function (Blueprint $table) {
            $table->dropUnique(['invite_code']);
            $table->dropColumn('invite_code');
        });
    }
};
