<?php

namespace Tests\Feature;

use App\Support\Features;
use Laravel\Sanctum\Sanctum;

/**
 * Funktions-Schalter (App\Support\Features): „fuer alle" im Admin-Bereich und
 * „nur fuer mich" als Vorschau eines Admins. Das Stadt-Bingo ist aus der
 * Testphase geholt und standardmaessig AUS.
 */
class FeatureFlagsTest extends MarketplaceTestCase
{
    public function test_standard_bingo_aus_saison_automatisch(): void
    {
        $this->actingAsUser();

        $this->getJson('/api/features')->assertOk()->assertExactJson(['data' => ['bingo' => false, 'season' => null]]);
        $this->getJson('/api/bingo')->assertForbidden();
    }

    public function test_nur_admins_duerfen_schalten(): void
    {
        $this->actingAsUser();

        $this->getJson('/api/admin/features')->assertForbidden();
        $this->putJson('/api/admin/features/bingo', ['enabled' => true])->assertForbidden();
        $this->putJson('/api/admin/features/bingo/preview', ['mode' => 'on'])->assertForbidden();
    }

    public function test_fuer_alle_einschalten_zeigt_allen_das_bingo(): void
    {
        $admin = $this->user(['is_admin' => true]);
        $user = $this->user();

        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/features/bingo', ['enabled' => true])
            ->assertOk()
            ->assertJsonPath('data.global.bingo.enabled', true);

        Sanctum::actingAs($user);
        $this->getJson('/api/features')->assertJsonPath('data.bingo', true);
        $this->getJson('/api/bingo')
            ->assertOk()
            ->assertJsonCount(9, 'data.cells')
            ->assertJsonPath('data.cells.4.kind', 'joker');
    }

    public function test_nur_fuer_mich_wirkt_nur_beim_admin_selbst(): void
    {
        $admin = $this->user(['is_admin' => true]);
        $user = $this->user();

        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/features/bingo/preview', ['mode' => 'on'])
            ->assertOk()
            ->assertJsonPath('data.preview.bingo.mode', 'on')
            ->assertJsonPath('data.global.bingo.enabled', false)
            ->assertJsonPath('data.effective.bingo', true);
        $this->getJson('/api/bingo')->assertOk();

        Sanctum::actingAs($user);
        $this->getJson('/api/features')->assertJsonPath('data.bingo', false);
        $this->getJson('/api/bingo')->assertForbidden();

        // „Aus" schlägt „für alle an" – zum Gegenprüfen der Ansicht ohne Bingo.
        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/features/bingo', ['enabled' => true])->assertOk();
        $this->putJson('/api/admin/features/bingo/preview', ['mode' => 'off'])->assertJsonPath('data.effective.bingo', false);
        $this->putJson('/api/admin/features/bingo/preview', ['mode' => 'inherit'])->assertJsonPath('data.effective.bingo', true);
    }

    public function test_vorschau_eines_ehemaligen_admins_zaehlt_nicht(): void
    {
        $admin = $this->user(['is_admin' => true]);
        Features::setPreview($admin, 'bingo', 'on', null);
        $admin->forceFill(['is_admin' => false])->save();

        $this->assertFalse(Features::enabled($admin->fresh(), 'bingo'));
    }

    public function test_saison_thema_fuer_alle_und_als_vorschau(): void
    {
        $admin = $this->user(['is_admin' => true]);
        $user = $this->user();

        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/features/season', ['value' => 'advent'])->assertOk()->assertJsonPath('data.global.season.value', 'advent');
        $this->putJson('/api/admin/features/season/preview', ['value' => 'summer'])->assertJsonPath('data.effective.season', 'summer');
        // „auto" als Vorschau heißt: für mich nach Datum, egal was für alle gilt.
        $this->putJson('/api/admin/features/season/preview', ['value' => 'auto'])->assertJsonPath('data.effective.season', null);
        $this->putJson('/api/admin/features/season/preview', ['value' => 'inherit'])->assertJsonPath('data.effective.season', 'advent');

        Sanctum::actingAs($user);
        $this->getJson('/api/features')->assertJsonPath('data.season', 'advent');
    }

    public function test_unbekannte_schalter_und_werte_werden_abgelehnt(): void
    {
        Sanctum::actingAs($this->user(['is_admin' => true]));

        $this->putJson('/api/admin/features/gibtsnicht', ['enabled' => true])->assertNotFound();
        $this->putJson('/api/admin/features/season', ['value' => 'karneval'])->assertUnprocessable();
        $this->putJson('/api/admin/features/bingo/preview', ['mode' => 'vielleicht'])->assertUnprocessable();
    }

    public function test_bingo_abholen_nur_fuer_bingo_schluessel(): void
    {
        $admin = $this->user(['is_admin' => true]);
        Sanctum::actingAs($admin);
        $this->putJson('/api/admin/features/bingo', ['enabled' => true])->assertOk();

        $user = $this->actingAsUser();
        // Eine Challenge über den Bingo-Weg abzuholen geht nicht.
        $this->postJson('/api/bingo/claim', ['key' => 'challenge:1'])->assertUnprocessable();
        // Eine noch nicht volle Reihe auch nicht.
        $this->postJson('/api/bingo/claim', ['key' => 'bingo:line:0'])->assertUnprocessable();
        $this->assertSame(0, (int) $user->fresh()->credits_balance);
    }
}
