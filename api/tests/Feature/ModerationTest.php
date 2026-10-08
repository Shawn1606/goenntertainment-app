<?php

namespace Tests\Feature;

use App\Http\Controllers\Admin\UserController;
use App\Models\Booking;
use App\Models\ChatMessage;
use App\Models\Group;
use App\Models\User;
use App\Support\Bookings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

/**
 * Moderation (AGENTS.md: every kind of user content needs moderation and a report path): Admins
 * loeschen jede Chat-Nachricht, benennen Gruppen um oder loeschen sie und setzen Profilname und
 * Profilbild zurueck - ohne Mitglied zu sein. Meldungen halten fest, was gemeldet wurde, auch wenn
 * es danach geloescht oder umbenannt wird. Dazu die Admin-Listen der Meldungen und Buchungen.
 */
class ModerationTest extends MarketplaceTestCase
{
    private function admin(): User
    {
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();

        return $admin;
    }

    /** Eine Gruppe von $owner mit $members und einer Nachricht von $author: [Gruppen-ID, Nachrichten-ID]. */
    private function chat(User $owner, array $members, User $author, string $body): array
    {
        Sanctum::actingAs($owner);
        $groupId = $this->postJson('/api/groups', ['name' => 'Donnerstagsrunde', 'description' => 'Bowling und so'])->assertCreated()->json('data.id');
        foreach ($members as $member) {
            DB::table('group_members')->insert(['group_id' => $groupId, 'user_id' => $member->id, 'created_at' => now()]);
        }
        Sanctum::actingAs($author);
        $messageId = $this->postJson("/api/groups/{$groupId}/messages", ['body' => $body])->assertCreated()->json('data.id');

        return [$groupId, $messageId];
    }

    public function test_nur_admins_moderieren(): void
    {
        $owner = $this->user();
        [$groupId, $messageId] = $this->chat($owner, [], $owner, 'Hallo');
        $target = $this->user();
        $routes = [
            ['DELETE', "/api/admin/messages/{$messageId}", []],
            ['PATCH', "/api/admin/groups/{$groupId}", ['name' => 'Gekapert']],
            ['DELETE', "/api/admin/groups/{$groupId}", []],
            ['POST', "/api/admin/users/{$target->id}/clear-profile", ['name' => true]],
        ];

        $this->app['auth']->forgetGuards();
        foreach ($routes as [$method, $path, $body]) {
            $this->withHeaders(['Authorization' => 'Bearer not-a-token'])->json($method, $path, $body)->assertUnauthorized();
        }

        Sanctum::actingAs($this->user());
        foreach ($routes as [$method, $path, $body]) {
            $this->json($method, $path, $body)->assertForbidden()->assertJsonPath('message', 'Nur für Admins.');
        }

        $this->assertTrue(ChatMessage::whereKey($messageId)->exists());
        $this->assertSame('Donnerstagsrunde', Group::findOrFail($groupId)->name);
        $this->assertSame($target->name, $target->fresh()->name);
    }

    public function test_admin_loescht_jede_nachricht_auch_ohne_mitgliedschaft(): void
    {
        $owner = $this->user();
        [, $messageId] = $this->chat($owner, [], $owner, 'Etwas Anstoessiges');

        $this->admin();
        // Der Weg der Mitglieder bleibt Mitgliedern vorbehalten ...
        $this->deleteJson("/api/messages/{$messageId}")->assertNotFound();
        // ... der Admin-Weg nicht.
        $this->deleteJson("/api/admin/messages/{$messageId}")->assertOk()->assertJsonPath('message', 'Nachricht gelöscht.');
        $this->assertFalse(ChatMessage::whereKey($messageId)->exists());
        $this->deleteJson("/api/admin/messages/{$messageId}")->assertNotFound();
    }

    public function test_admin_benennt_gruppen_um_und_loescht_sie(): void
    {
        $owner = $this->user();
        $member = $this->user();
        [$groupId, $messageId] = $this->chat($owner, [$member], $member, 'Hallo');

        $this->admin();
        $this->patchJson("/api/admin/groups/{$groupId}", [])->assertStatus(422);
        $this->patchJson("/api/admin/groups/{$groupId}", ['name' => str_repeat('x', Group::MAX_NAME + 1)])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->patchJson("/api/admin/groups/{$groupId}", ['name' => ['x']])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->patchJson("/api/admin/groups/{$groupId}", ['description' => str_repeat('x', Group::MAX_DESCRIPTION + 1)])->assertStatus(422);

        $this->patchJson("/api/admin/groups/{$groupId}", ['name' => '  Gruppe 7  ', 'description' => null])
            ->assertOk()
            ->assertJsonPath('message', 'Gruppe geändert.')
            ->assertJsonPath('data.id', $groupId)
            ->assertJsonPath('data.name', 'Gruppe 7')
            ->assertJsonPath('data.description', null)
            ->assertJsonPath('data.owner_id', $owner->id)
            ->assertJsonPath('data.members_count', 2);
        $this->assertSame('Gruppe 7', Group::findOrFail($groupId)->name);

        $this->deleteJson("/api/admin/groups/{$groupId}")->assertOk()->assertJsonPath('message', 'Gruppe gelöscht.');
        $this->assertNull(Group::find($groupId));
        $this->assertFalse(ChatMessage::whereKey($messageId)->exists(), 'the chat went with the group');
        $this->assertSame(0, DB::table('group_members')->where('group_id', $groupId)->count());
        $this->deleteJson("/api/admin/groups/{$groupId}")->assertNotFound();
        $this->patchJson("/api/admin/groups/{$groupId}", ['name' => 'X'])->assertNotFound();
    }

    public function test_admin_setzt_profilname_und_profilbild_zurueck(): void
    {
        Storage::fake('public');
        $avatar = 'avatars/'.str_repeat('ab', 20).'.jpg';
        Storage::disk('public')->put($avatar, 'image bytes');
        $user = $this->user(['name' => 'Ein anstoessiger Name', 'username' => 'lena_m', 'avatar' => $avatar]);
        $nameless = $this->user(['name' => 'Auch anstoessig', 'username' => null]);
        $admin = $this->admin();

        $this->postJson("/api/admin/users/{$user->id}/clear-profile", [])->assertStatus(422);
        $this->postJson("/api/admin/users/{$user->id}/clear-profile", ['name' => 'ja'])->assertStatus(422);
        $this->postJson("/api/admin/users/{$admin->id}/clear-profile", ['name' => true])->assertStatus(400);
        $this->postJson('/api/admin/users/999999999/clear-profile', ['name' => true])->assertNotFound();

        // Nur der Name: Er wird der Benutzername, das Bild bleibt.
        $this->postJson("/api/admin/users/{$user->id}/clear-profile", ['name' => true])
            ->assertOk()
            ->assertJsonPath('message', 'Profil zurückgesetzt.')
            ->assertJsonPath('data.id', $user->id)
            ->assertJsonPath('data.name', 'lena_m');
        $this->assertSame($avatar, $user->fresh()->avatar);
        Storage::disk('public')->assertExists($avatar);

        // Das Bild: weg aus dem Konto und von der Platte.
        $this->postJson("/api/admin/users/{$user->id}/clear-profile", ['avatar' => true])
            ->assertOk()
            ->assertJsonPath('data.avatar', null);
        $this->assertNull($user->fresh()->avatar);
        Storage::disk('public')->assertMissing($avatar);

        // Ohne Benutzernamen: ein neutraler Name, nie ein leerer.
        $this->postJson("/api/admin/users/{$nameless->id}/clear-profile", ['name' => true, 'avatar' => true])
            ->assertOk()
            ->assertJsonPath('data.name', UserController::NEUTRAL_NAME);
    }

    /**
     * Gemeldet, dann geloescht oder umbenannt: Der Admin sieht trotzdem, was gemeldet wurde - Text,
     * Verfasser:in und Gruppe aus dem Moment der Meldung, nie eine E-Mail-Adresse.
     */
    public function test_meldung_haelt_fest_was_gemeldet_wurde(): void
    {
        $owner = $this->user(['name' => 'Anna Gruppe', 'username' => 'anna_g']);
        $author = $this->user(['name' => 'Ben Autor', 'username' => 'ben_a']);
        $reporter = $this->user();
        $outsider = $this->user();
        [$groupId, $messageId] = $this->chat($owner, [$author, $reporter], $author, 'Du bist so ein Idiot');

        Sanctum::actingAs($reporter);
        $this->postJson('/api/reports', ['target_type' => 'message', 'target_id' => $messageId, 'reason' => 'harassment'])->assertCreated();
        $this->postJson('/api/reports', ['target_type' => 'user', 'target_id' => $author->id, 'reason' => 'harassment'])->assertCreated();
        $this->postJson('/api/reports', ['target_type' => 'group', 'target_id' => $groupId, 'reason' => 'spam'])->assertCreated();
        // Wer nicht in der Gruppe ist, holt keine fremde Nachricht in den Admin-Bereich.
        Sanctum::actingAs($outsider);
        $this->postJson('/api/reports', ['target_type' => 'message', 'target_id' => $messageId, 'reason' => 'spam'])->assertCreated();

        // Die Verfasserin raeumt gleich danach auf.
        Sanctum::actingAs($author);
        $this->deleteJson("/api/messages/{$messageId}")->assertOk();
        $this->patchJson('/api/user', ['name' => 'Ganz Harmlos'])->assertOk();

        $this->admin();
        $response = $this->getJson('/api/admin/reports')->assertOk();
        $reports = collect($response->json('data'));

        $message = $reports->where('target_type', 'message')->firstWhere('reporter_name', $reporter->name);
        $this->assertNull($message['target'], 'the message is gone');
        $this->assertSame('Du bist so ein Idiot', $message['snapshot']['text']);
        $this->assertEquals(['id' => $author->id, 'username' => 'ben_a', 'name' => 'Ben Autor'], $message['snapshot']['author']);
        $this->assertEquals(['id' => $groupId, 'name' => 'Donnerstagsrunde'], $message['snapshot']['group']);
        $this->assertNotNull($message['snapshot']['created_at']);

        $this->assertNull($reports->where('target_type', 'message')->firstWhere('reporter_name', $outsider->name)['snapshot']);

        $user = $reports->firstWhere('target_type', 'user');
        $this->assertSame('Ganz Harmlos', $user['target']);
        $this->assertEquals(['id' => $author->id, 'username' => 'ben_a', 'name' => 'Ben Autor'], $user['snapshot']['user']);

        $group = $reports->firstWhere('target_type', 'group');
        $this->assertSame('Donnerstagsrunde', $group['snapshot']['name']);
        $this->assertSame('Bowling und so', $group['snapshot']['description']);
        $this->assertSame('anna_g', $group['snapshot']['owner']['username']);

        foreach ([$owner, $author, $reporter, $outsider] as $person) {
            $this->assertStringNotContainsString($person->email, $response->getContent());
        }
    }

    /** GET und PATCH /api/admin/reports: nur Admins; bearbeiten, wieder oeffnen, filtern. */
    public function test_meldungen_lesen_und_bearbeiten(): void
    {
        $this->getJson('/api/admin/reports')->assertUnauthorized();

        $reporter = $this->actingAsUser();
        $target = $this->user();
        $this->postJson('/api/reports', ['target_type' => 'user', 'target_id' => $target->id, 'reason' => 'spam', 'note' => 'Wirbt fuer Fremdes'])->assertCreated();
        $id = (int) DB::table('content_reports')->where('reporter_id', $reporter->id)->value('id');

        $this->getJson('/api/admin/reports')->assertForbidden();
        $this->patchJson("/api/admin/reports/{$id}", ['status' => 'reviewed'])->assertForbidden();

        $admin = $this->admin();
        $this->getJson('/api/admin/reports')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $id)
            ->assertJsonPath('data.0.status', 'open')
            ->assertJsonPath('data.0.reason', 'spam')
            ->assertJsonPath('data.0.note', 'Wirbt fuer Fremdes')
            ->assertJsonPath('data.0.target', $target->name);

        $this->patchJson("/api/admin/reports/{$id}", ['status' => 'erledigt'])->assertStatus(422);
        $this->patchJson('/api/admin/reports/999999999', ['status' => 'reviewed'])->assertNotFound();
        $this->patchJson("/api/admin/reports/{$id}", ['status' => 'reviewed'])->assertOk()->assertJsonPath('message', 'Meldung aktualisiert.');

        $this->getJson('/api/admin/reports')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/admin/reports?status=all')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'reviewed')
            ->assertJsonPath('data.0.handled_by_name', $admin->name);

        // Wieder offen: Wer bearbeitet hat, steht nicht mehr dabei.
        $this->patchJson("/api/admin/reports/{$id}", ['status' => 'open'])->assertOk();
        $this->getJson('/api/admin/reports')->assertJsonPath('data.0.handled_by_name', null);
    }

    /** GET /api/admin/bookings: nur Admins; die letzten Buchungen mit Konto, nach Zustand filterbar. */
    public function test_admin_buchungen_lesen(): void
    {
        $this->getJson('/api/admin/bookings')->assertUnauthorized();

        $customer = $this->user(['name' => 'Lena Muster']);
        $offer = $this->offer($this->partner());
        $open = Bookings::create($customer, $offer, 2, 'money', null, null);
        Bookings::cancel(Bookings::create($customer, $offer, 1, 'money', null, null));

        Sanctum::actingAs($customer);
        $this->getJson('/api/admin/bookings')->assertForbidden();

        $this->admin();
        $this->getJson('/api/admin/bookings')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.1.id', $open->id)
            ->assertJsonPath('data.1.user.name', 'Lena Muster')
            ->assertJsonPath('data.1.people', 2);
        $this->getJson('/api/admin/bookings?status=cancelled')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'cancelled');
        $this->assertSame(2, Booking::where('user_id', $customer->id)->count());
    }
}
