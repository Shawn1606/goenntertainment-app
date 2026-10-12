<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\Group;
use App\Rules\NoBlockedTerms;
use App\Support\Format;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Nutzer-Inhalte moderieren: Nachrichten im Gruppen-Chat und Gruppen.
 *
 * Beides laesst sich melden (SafetyController) - und zu jedem Meldeweg gehoert, dass ein Admin
 * den Inhalt auch entfernen kann. Bisher ging das bei einer Nachricht nur, wenn der Admin selbst
 * in der Gruppe war, und an eine Gruppe kam er gar nicht. Hier geht beides ohne Mitgliedschaft;
 * was gemeldet wurde, haelt die Meldung selbst fest (`snapshot`), auch nach dem Loeschen.
 *
 * Profilname und Profilbild eines Kontos setzt Admin\UserController::clearProfile zurueck.
 */
class ModerationController extends Controller
{
    /** DELETE /api/admin/messages/{id} - jede Nachricht, auch ohne Mitgliedschaft in der Gruppe. */
    public function destroyMessage(int $id): JsonResponse
    {
        $message = ChatMessage::find($id);
        abort_if($message === null, 404, 'Diese Nachricht gibt es nicht.');

        $message->delete();

        return response()->json(['message' => 'Nachricht gelöscht.']);
    }

    /**
     * PATCH /api/admin/groups/{id} {name?, description?} - einen anstoessigen Namen ersetzen
     * oder die Beschreibung aendern bzw. leeren (`description: null`).
     */
    public function updateGroup(Request $request, int $id): JsonResponse
    {
        $group = $this->group($id);

        $data = $request->validate([
            'name' => ['sometimes', 'bail', 'required', 'string', 'max:'.Group::MAX_NAME, new NoBlockedTerms('name')],
            'description' => ['sometimes', 'nullable', 'bail', 'string', 'max:'.Group::MAX_DESCRIPTION, new NoBlockedTerms('text')],
        ], [
            'name.required' => 'Gib der Gruppe einen Namen.',
            'name.string' => 'Gib der Gruppe einen Namen.',
            'name.max' => 'Der Name fasst höchstens '.Group::MAX_NAME.' Zeichen.',
            'description.string' => 'Die Beschreibung muss ein Text sein.',
            'description.max' => 'Die Beschreibung fasst höchstens '.Group::MAX_DESCRIPTION.' Zeichen.',
        ]);

        if ($data === []) {
            throw ValidationException::withMessages(['name' => ['Was soll sich ändern? Name oder Beschreibung.']]);
        }
        if (array_key_exists('name', $data)) {
            $data['name'] = trim($data['name']);
            if ($data['name'] === '') {
                throw ValidationException::withMessages(['name' => ['Gib der Gruppe einen Namen.']]);
            }
        }
        if (array_key_exists('description', $data)) {
            $data['description'] = trim((string) $data['description']) ?: null;
        }

        $group->update($data);

        return response()->json(['message' => 'Gruppe geändert.', 'data' => $this->present($group)]);
    }

    /** DELETE /api/admin/groups/{id} - Chat, Mitglieder und Abstimmungen gehen mit (CASCADE). */
    public function destroyGroup(int $id): JsonResponse
    {
        $this->group($id)->delete();

        return response()->json(['message' => 'Gruppe gelöscht.']);
    }

    private function group(int $id): Group
    {
        $group = Group::find($id);
        abort_if($group === null, 404, 'Diese Gruppe gibt es nicht.');

        return $group;
    }

    /** @return array{id: int, name: string, description: string|null, owner_id: int, members_count: int, updated_at: string|null} */
    private function present(Group $group): array
    {
        return [
            'id' => $group->id,
            'name' => $group->name,
            'description' => $group->description,
            'owner_id' => $group->owner_id,
            'members_count' => $group->members()->count(),
            'updated_at' => Format::iso($group->updated_at),
        ];
    }
}
