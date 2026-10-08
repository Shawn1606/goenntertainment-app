<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Der Marktplatz: Partner, ihre Angebote, Buchungen, Credits, Stempelkarte,
 * Gutscheine und die Club-Stufe am Konto.
 *
 * ## Die Grundsaetze
 *
 * - **Credits sind ein Konto mit Buchungszeilen.** `users.credits_balance` ist
 *   der Stand, `credit_transactions` jede einzelne Bewegung mit dem Stand danach.
 *   Beides wird in derselben Transaktion geschrieben (App\Support\Wallet); so
 *   laesst sich jeder Stand auf den Cent - bzw. Credit - nachrechnen.
 * - **Buchungen tragen ihren Preis selbst.** Rabatt, Stufe und Summe stehen in
 *   der Zeile, wie sie beim Buchen galten. Aendert der Partner spaeter den Preis,
 *   aendert sich an alten Buchungen nichts.
 * - **Loeschen zerstoert keine Abrechnung.** Wird ein Konto, Angebot oder Partner
 *   geloescht, bleibt die Buchung mit NULL-Verweis und Titel-Schnappschuss stehen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // free | gold | platinum (shared/club.json)
            $table->string('club_plan', 20)->default('free');
            $table->dateTime('club_since')->nullable();
            // Naechste Verlaengerung. NULL bei Free.
            $table->dateTime('club_renews_at')->nullable();
            // Gekuendigt: laeuft bis club_renews_at, dann Free.
            $table->boolean('club_cancel_at_period_end')->default(false);
            $table->integer('credits_balance')->default(0);
        });

        Schema::create('partners', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 80)->unique();
            $table->string('name', 120);
            $table->string('tagline', 160)->nullable();
            $table->text('description')->nullable();
            $table->foreignId('interest_id')->nullable()->constrained('interests')->nullOnDelete();
            $table->string('address', 200)->nullable();
            $table->string('city', 80)->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->string('logo_path')->nullable();
            $table->string('cover_path')->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('website', 200)->nullable();
            $table->string('instagram', 80)->nullable();
            $table->string('opening_hours', 500)->nullable();
            // Steht auf dem NFC-/QR-Aufkleber an der Kasse. Neu wuerfeln macht alte
            // Aufkleber wertlos (App\Http\Controllers\Admin\PartnerController).
            $table->string('checkin_token', 40)->unique();
            // Hoechstrabatt fuer alle Angebote, wenn das Angebot selbst keinen setzt.
            $table->unsignedTinyInteger('max_discount_percent')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('is_featured')->default(false);
            $table->timestamps();
        });

        Schema::create('partner_staff', function (Blueprint $table) {
            $table->foreignId('partner_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20)->default('staff');
            $table->timestamp('created_at')->nullable();
            $table->primary(['partner_id', 'user_id']);
        });

        Schema::create('offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('partner_id')->constrained()->cascadeOnDelete();
            // activity = buchbare Aktivitaet, perk = Vorteil vor Ort (Freigetraenk)
            $table->string('kind', 20)->default('activity');
            $table->string('title', 120);
            $table->string('subtitle', 160)->nullable();
            $table->text('description')->nullable();
            $table->foreignId('interest_id')->nullable()->constrained('interests')->nullOnDelete();
            $table->string('image_path')->nullable();
            // Mindestens einer der beiden Preise ist gesetzt (App\Http\Requests\Admin\OfferRequest).
            $table->unsignedInteger('price_cents')->nullable();
            $table->unsignedInteger('price_credits')->nullable();
            $table->unsignedTinyInteger('max_discount_percent')->nullable();
            $table->unsignedSmallInteger('min_people')->default(1);
            $table->unsignedSmallInteger('max_people')->nullable();
            $table->unsignedTinyInteger('min_age')->nullable();
            $table->unsignedTinyInteger('max_age')->nullable();
            $table->unsignedSmallInteger('duration_minutes')->nullable();
            // NULL = unbekannt / beides
            $table->boolean('indoor')->nullable();
            // Wie lange eine Buchung einloesbar bleibt.
            $table->unsignedSmallInteger('valid_days')->default(90);
            $table->boolean('is_active')->default(true);
            $table->boolean('is_featured')->default(false);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
            $table->index(['is_active', 'kind']);
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            // credits | plan | booking
            $table->string('purpose', 20);
            $table->unsignedInteger('amount_cents');
            // test = simulierte Zahlung (App\Support\Payments)
            $table->string('provider', 20);
            $table->string('provider_ref', 120)->nullable();
            // succeeded | refunded | failed
            $table->string('status', 20);
            $table->string('description', 200);
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            // Wird beim Partner vorgezeigt: 8 Zeichen ohne Verwechsler (0/O, 1/I).
            $table->string('code', 12)->unique();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('offer_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('partner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('group_id')->nullable()->constrained('friend_groups')->nullOnDelete();
            $table->string('offer_title', 120);
            $table->string('partner_name', 120);
            $table->unsignedSmallInteger('people');
            $table->string('plan_key', 20);
            // money | credits
            $table->string('pay_method', 10);
            $table->unsignedInteger('unit_price_cents')->nullable();
            $table->unsignedInteger('unit_credits')->nullable();
            $table->decimal('discount_percent', 5, 2)->default(0);
            $table->unsignedInteger('subtotal_cents')->default(0);
            $table->unsignedInteger('discount_cents')->default(0);
            $table->unsignedInteger('total_cents')->default(0);
            $table->unsignedInteger('subtotal_credits')->default(0);
            $table->unsignedInteger('total_credits')->default(0);
            // confirmed | redeemed | cancelled
            $table->string('status', 12)->default('confirmed');
            $table->date('preferred_date')->nullable();
            $table->dateTime('valid_until');
            $table->dateTime('redeemed_at')->nullable();
            $table->foreignId('redeemed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('cancelled_at')->nullable();
            $table->foreignId('payment_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
            $table->index(['user_id', 'status']);
            $table->index(['partner_id', 'status']);
        });

        Schema::create('voucher_batches', function (Blueprint $table) {
            $table->id();
            $table->string('label', 120);
            // Wo die Karten verkauft werden (REWE, Kaufland, ...). Nur zur Uebersicht.
            $table->string('retailer', 80)->nullable();
            $table->unsignedInteger('credits');
            $table->unsignedInteger('quantity');
            $table->dateTime('expires_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('batch_id')->constrained('voucher_batches')->cascadeOnDelete();
            // Ohne Bindestriche, Grossbuchstaben: so wird verglichen.
            $table->string('code', 20)->unique();
            $table->unsignedInteger('credits');
            $table->dateTime('expires_at')->nullable();
            $table->foreignId('redeemed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('redeemed_at')->nullable();
            $table->dateTime('disabled_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('checkins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('partner_id')->constrained()->cascadeOnDelete();
            // nfc | qr (Kunde scannt Aufkleber) | pass (Partner scannt Kunden-Pass)
            $table->string('method', 10);
            $table->foreignId('staff_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('stamped')->default(false);
            $table->timestamp('created_at')->nullable();
            $table->index(['partner_id', 'created_at']);
        });

        Schema::create('stamps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('partner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('checkin_id')->nullable()->constrained()->nullOnDelete();
            // Ortsdatum: hoechstens ein Stempel pro Partner und Kalendertag.
            $table->date('stamp_day');
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'partner_id', 'stamp_day']);
        });

        Schema::create('credit_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Positiv = Gutschrift, negativ = Abbuchung.
            $table->integer('amount');
            $table->integer('balance_after');
            // purchase | voucher | stamp_reward | monthly | booking | refund | admin
            $table->string('kind', 20);
            $table->string('description', 200);
            $table->foreignId('booking_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('payment_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('voucher_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('created_at')->nullable();
            $table->index(['user_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_transactions');
        Schema::dropIfExists('stamps');
        Schema::dropIfExists('checkins');
        Schema::dropIfExists('vouchers');
        Schema::dropIfExists('voucher_batches');
        Schema::dropIfExists('bookings');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('offers');
        Schema::dropIfExists('partner_staff');
        Schema::dropIfExists('partners');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['club_plan', 'club_since', 'club_renews_at', 'club_cancel_at_period_end', 'credits_balance']);
        });
    }
};
