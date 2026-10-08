<?php

namespace Tests\Feature;

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
