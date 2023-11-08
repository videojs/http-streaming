# Content Steering

Content Steering provides content creators a method of runtime control over
the location where segments are fetched via a content steering server and
pathways defined in the content manifest. For a working example visit
https://www.content-steering.com/.

HLS and DASH each define their own specific Content Steering tags and properties
that prescribe how the client will fetch the content steering manifest as well
as make steering decisions. `#EXT-X-CONTENT-STEERING` and `<ContentSteering>` respectively.

For reference, HLS spec section 4.4.6.6:
https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis#section-4.4.6.6

DASH-IF:
https://dashif.org/docs/DASH-IF-CTS-00XX-Content-Steering-Community-Review.pdf

Both protocols rely on a content steering server to provide steering guidance.
VHS will request the content steering manifest from the location defined in the
content steering tag in the `.m3u8` or `.mpd` and refresh the steering manifest
at an interval defined in that manifest.

Content steering manifest response will look something like this:
```
{
 "VERSION": 1,
 "TTL": 300,
 "RELOAD-URI": "https://steeringservice.com/app/instance12345?session=abc",
 "CDN-PRIORITY": ["beta","alpha"]
}
```
Where `CDN-PRIORITY` represents either `PATHWAY-PRIORITY` for HLS or `SERVICE-LOCATION-PRIORITY` for DASH. This priority collection of keys will match with either a `PATHWAY-ID` or `serviceLocation` (HLS and DASH respectively) associated with a location where VHS can fetch segments.

VHS will attempt to fetch segments from the locations defined in the steering manifest response, in the order, then during playback provide quality of experience metrics back to the steering server which can then adjust the steering decision accordingly.
