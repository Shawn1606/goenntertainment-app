<?php

namespace Tests\Feature;

use App\Http\Controllers\ChatController;
use App\Models\ChatMessage;
use App\Models\Group;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

class GroupChatTest extends MarketplaceTestCase
{
    public function test_gruppe_anlegen_per_code_beitreten_und_chatten(): void
    {
        $owner = $this->actingAsUser(['name' => 'Anna']);
        $group = $this->postJson('/api/groups', ['name' => 'Donnerstagsrunde'])
            ->assertCreated()
            ->assertJsonPath('data.is_owner', true)
            ->assertJsonPath('data.members_count', 1)
            ->json('data');

        $friend = $this->user(['name' => 'Ben']);
        Sanctum::actingAs($friend);

        // Ohne Mitgliedschaft gibt es die Gruppe nicht.
        $this->getJson("/api/groups/{$group['id']}")->assertNotFound();

        $this->getJson('/api/groups/invite/'.$group['invite_code'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Donnerstagsrunde')
            ->assertJsonPath('data.is_member', false)
            ->assertJsonPath('data.id', null);

        $this->postJson('/api/groups/join', ['code' => 'https://goe4fun.de/g/'.$group['invite_code']])
            ->assertOk()
            ->assertJsonPath('data.members_count', 2);

        $this->postJson("/api/groups/{$group['id']}/messages", ['body' => "  Hallo\n\n\n\nzusammen  "])
            ->assertCreated()
            ->assertJsonPath('data.body', "Hallo\n\nzusammen")
            ->assertJsonPath('data.is_mine', true);
        $this->postJson("/api/groups/{$group['id']}/messages", ['body' => '   '])->assertStatus(422);

        Sanctum::actingAs($owner);
        $this->getJson('/api/groups')->assertJsonPath('data.0.unread', 1);
        $this->getJson("/api/groups/{$group['id']}/messages")
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('room.can_moderate', true);
        $this->postJson("/api/groups/{$group['id']}/read")->assertOk();
        $this->getJson('/api/groups')->assertJsonPath('data.0.unread', 0);

        // Neuer Code: der alte taugt nicht mehr.
        $fresh = $this->postJson("/api/groups/{$group['id']}/invite-code")->json('data.invite_code');
        $this->assertNotSame($group['invite_code'], $fresh);
        $this->getJson('/api/groups/invite/'.$group['invite_code'])->assertNotFound();

        // Wer angelegt hat, kann nicht gehen - nur loeschen.
        $this->deleteJson("/api/groups/{$group['id']}/members/{$owner->id}")->assertStatus(422);
        $this->deleteJson("/api/groups/{$group['id']}/members/{$friend->id}")->assertOk()->assertJsonPath('data.members_count', 1);
    }

    public function test_angebot_im_chat_teilen_und_gruppenbuchung(): void
    {
        $owner = $this->actingAsUser();
        $offer = $this->offer($this->partner(), ['title' => 'Escape Room']);
        $group = $this->postJson('/api/groups', ['name' => 'Crew'])->json('data');

        $this->postJson("/api/groups/{$group['id']}/messages", ['offer_id' => $offer->id])
            ->assertCreated()
            ->assertJsonPath('data.shared.title', 'Escape Room')
            ->assertJsonPath('data.shared.price_cents', 2999);

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 4, 'pay_method' => 'money', 'group_id' => $group['id']])
            ->assertCreated()
            ->assertJsonPath('data.group.name', 'Crew');

        $this->getJson("/api/groups/{$group['id']}")->assertJsonPath('data.bookings.0.people', 4);

        // Fremde Gruppe beim Buchen: abgelehnt.
        $stranger = $this->user();
        Sanctum::actingAs($stranger);
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money', 'group_id' => $group['id']])
            ->assertStatus(422)->assertJsonValidationErrors('group_id');
    }

    /** Ein Doppeltipp auf „Beitreten" ist kein Fehler (und kein 500); eine volle Gruppe nimmt niemanden mehr. */
    public function test_beitreten_zweimal_und_volle_gruppe(): void
    {
        $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Runde'])->json('data');

        Sanctum::actingAs($this->user());
        $this->postJson('/api/groups/join', ['code' => $group['invite_code']])->assertOk()->assertJsonPath('data.members_count', 2);
        $this->postJson('/api/groups/join', ['code' => $group['invite_code']])->assertOk()->assertJsonPath('data.members_count', 2);
        $this->assertSame(2, DB::table('group_members')->where('group_id', $group['id'])->count());

        // Auffuellen bis MAX_MEMBERS: Wer danach kommt, bleibt draussen.
        $missing = Group::MAX_MEMBERS - 2;
        foreach (range(1, $missing) as $i) {
            DB::table('group_members')->insert(['group_id' => $group['id'], 'user_id' => $this->user()->id, 'created_at' => now()]);
        }
        Sanctum::actingAs($this->user());
        $this->postJson('/api/groups/join', ['code' => $group['invite_code']])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Diese Gruppe ist voll ('.Group::MAX_MEMBERS.' Leute).');
        $this->assertSame(Group::MAX_MEMBERS, DB::table('group_members')->where('group_id', $group['id'])->count());
    }

    /** PATCH und DELETE /api/groups/{id}: nur wer angelegt hat; wer nicht drin ist, sieht die Gruppe gar nicht. */
    public function test_gruppe_umbenennen_und_loeschen_nur_wer_angelegt_hat(): void
    {
        $this->patchJson('/api/groups/1', ['name' => 'X'])->assertUnauthorized();
        $this->deleteJson('/api/groups/1')->assertUnauthorized();

        $owner = $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Donnerstag'])->json('data');
        $member = $this->user();
        $stranger = $this->user();
        DB::table('group_members')->insert(['group_id' => $group['id'], 'user_id' => $member->id, 'created_at' => now()]);

        Sanctum::actingAs($stranger);
        $this->patchJson("/api/groups/{$group['id']}", ['name' => 'Gekapert'])->assertNotFound();
        $this->deleteJson("/api/groups/{$group['id']}")->assertNotFound();

        Sanctum::actingAs($member);
        $this->patchJson("/api/groups/{$group['id']}", ['name' => 'Gekapert'])->assertForbidden();
        $this->deleteJson("/api/groups/{$group['id']}")->assertForbidden();

        Sanctum::actingAs($owner);
        $this->patchJson("/api/groups/{$group['id']}", ['name' => str_repeat('x', Group::MAX_NAME + 1)])->assertStatus(422)->assertJsonValidationErrors('name');
        $this->patchJson("/api/groups/{$group['id']}", ['name' => '  Freitag  ', 'description' => 'Bowling'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Freitag')
            ->assertJsonPath('data.description', 'Bowling');
        $this->deleteJson("/api/groups/{$group['id']}")->assertOk()->assertJsonPath('message', 'Gruppe gelöscht.');

        $this->getJson("/api/groups/{$group['id']}")->assertNotFound();
        $this->assertSame(0, DB::table('group_members')->where('group_id', $group['id'])->count());
    }

    /** DELETE /api/messages/{id}: die eigene Nachricht, als Anlegende:r jede - und Fremde sehen keine. */
    public function test_nachricht_loeschen(): void
    {
        $this->deleteJson('/api/messages/1')->assertUnauthorized();

        $owner = $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Runde'])->json('data');
        $member = $this->user();
        $other = $this->user();
        foreach ([$member, $other] as $user) {
            DB::table('group_members')->insert(['group_id' => $group['id'], 'user_id' => $user->id, 'created_at' => now()]);
        }

        Sanctum::actingAs($member);
        $first = $this->postJson("/api/groups/{$group['id']}/messages", ['body' => 'Eins'])->json('data.id');
        $second = $this->postJson("/api/groups/{$group['id']}/messages", ['body' => 'Zwei'])->json('data.id');

        Sanctum::actingAs($this->user());
        $this->deleteJson("/api/messages/{$first}")->assertNotFound();

        Sanctum::actingAs($other);
        $this->deleteJson("/api/messages/{$first}")->assertForbidden();

        Sanctum::actingAs($member);
        $this->deleteJson("/api/messages/{$first}")->assertOk()->assertJsonPath('message', 'Nachricht gelöscht.');
        $this->deleteJson("/api/messages/{$first}")->assertNotFound();

        Sanctum::actingAs($owner);
        $this->deleteJson("/api/messages/{$second}")->assertOk();
        $this->assertSame(0, ChatMessage::whereIn('id', [$first, $second])->count());
    }

    /** Die Eingaben des Chats haben eine Form: Text bis 1000 Zeichen, ein Angebot als Zahl - sonst 422, nie 500. */
    public function test_chat_eingaben_werden_geprueft(): void
    {
        $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Runde'])->json('data');
        $offer = $this->offer($this->partner());
        $send = fn (array $body) => $this->postJson("/api/groups/{$group['id']}/messages", $body);

        $send(['body' => ['Hallo']])->assertStatus(422)->assertJsonValidationErrors('body');
        $send(['body' => str_repeat('a', ChatController::MAX_LENGTH + 1)])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Eine Nachricht fasst höchstens '.ChatController::MAX_LENGTH.' Zeichen.');
        $send(['body' => 'Hallo', 'offer_id' => 'abc'])->assertStatus(422)->assertJsonValidationErrors('offer_id');
        $send(['body' => 'Hallo', 'offer_id' => ['x']])->assertStatus(422)->assertJsonValidationErrors('offer_id');
        $send(['offer_id' => $offer->id + 1000])->assertStatus(422)->assertJsonPath('message', 'Dieses Angebot gibt es nicht mehr.');
        $this->assertSame(0, ChatMessage::count());

        $send(['body' => str_repeat('a', ChatController::MAX_LENGTH)])->assertCreated();
        $send(['offer_id' => $offer->id])->assertCreated()->assertJsonPath('data.shared.offer_id', $offer->id);
    }

    /** GET /api/blocks und DELETE /api/blocks/{userId}: die eigene Liste, und Aufheben macht Nachrichten wieder sichtbar. */
    public function test_blockliste_und_aufheben(): void
    {
        $this->getJson('/api/blocks')->assertUnauthorized();
        $this->deleteJson('/api/blocks/1')->assertUnauthorized();

        $me = $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Runde'])->json('data');
        $loud = $this->user(['name' => 'Laut Sprecher']);
        $someoneElse = $this->user();
        DB::table('group_members')->insert(['group_id' => $group['id'], 'user_id' => $loud->id, 'created_at' => now()]);
        // Was andere blockieren, gehoert nicht in meine Liste.
        DB::table('user_blocks')->insert(['blocker_id' => $someoneElse->id, 'blocked_id' => $me->id, 'created_at' => now()]);

        Sanctum::actingAs($loud);
        $this->postJson("/api/groups/{$group['id']}/messages", ['body' => 'Hallo'])->assertCreated();

        Sanctum::actingAs($me);
        $this->getJson('/api/blocks')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson('/api/blocks', ['user_id' => $loud->id])->assertCreated();
        $this->getJson('/api/blocks')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $loud->id)
            ->assertJsonPath('data.0.name', 'Laut Sprecher')
            ->assertJsonMissingPath('data.0.email');
        $this->getJson("/api/groups/{$group['id']}/messages")->assertJsonCount(0, 'data');

        $this->deleteJson("/api/blocks/{$loud->id}")->assertOk()->assertJsonPath('message', 'Blockierung aufgehoben.');
        $this->getJson('/api/blocks')->assertJsonCount(0, 'data');
        $this->getJson("/api/groups/{$group['id']}/messages")->assertJsonCount(1, 'data');
        // Fremde Blockierungen hebt niemand auf.
        $this->deleteJson("/api/blocks/{$me->id}")->assertOk();
        $this->assertSame(1, DB::table('user_blocks')->where('blocker_id', $someoneElse->id)->count());
    }

    public function test_blockierte_nachrichten_sieht_man_nicht(): void
    {
        $owner = $this->actingAsUser();
        $group = $this->postJson('/api/groups', ['name' => 'Runde'])->json('data');
        $other = $this->user();
        Sanctum::actingAs($other);
        $this->postJson('/api/groups/join', ['code' => $group['invite_code']]);
        $this->postJson("/api/groups/{$group['id']}/messages", ['body' => 'Hallo'])->assertCreated();

        Sanctum::actingAs($owner);
        $this->postJson('/api/blocks', ['user_id' => $other->id])->assertCreated();
        $this->getJson("/api/groups/{$group['id']}/messages")->assertJsonCount(0, 'data');
        $this->getJson('/api/groups')->assertJsonPath('data.0.unread', 0);

        $this->postJson('/api/reports', ['target_type' => 'user', 'target_id' => $other->id, 'reason' => 'spam'])->assertCreated();
        $this->postJson('/api/reports', ['target_type' => 'user', 'target_id' => $other->id, 'reason' => 'spam'])->assertCreated();
        $this->postJson('/api/reports', ['target_type' => 'post', 'target_id' => 1, 'reason' => 'spam'])->assertStatus(422);
    }
}
