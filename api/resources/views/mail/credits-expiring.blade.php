Hallo {{ $firstName }},

{{ $credits }} deiner Credits verfallen am {{ $date }} – in {{ $days }} {{ $days === 1 ? 'Tag' : 'Tagen' }}. Bezahlt wird immer zuerst mit den Credits, die am frühesten verfallen; du verlierst also nichts, wenn du jetzt etwas buchst.
@if (count($offers) > 0)

Damit könntest du zum Beispiel buchen:
@foreach ($offers as $offer)
- {{ $offer['title'] }} bei {{ $offer['partner'] }} – {{ $offer['credits'] }} Credits
@endforeach
@endif

Viel Spaß wünscht dir Goenni von GÖ4Fun
