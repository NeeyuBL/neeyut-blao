import unittest

from engine import (
    DetectionEpisode,
    OcrCandidate,
    TextObservation,
    build_detection_episodes,
    build_episode_cues,
    build_final_cues,
    detect_frame_observation,
    detection_sample_indices,
    is_text_evolution,
    normalize_text,
    ocr_frame_candidate,
    text_similarity,
    visual_episode_ranges,
)


def candidate(start, end, text, x1=500, confidence=0.92, frame_index=None):
    frame = int(start * 4) if frame_index is None else frame_index
    return OcrCandidate(start, end, text, confidence, (100, 250, x1, 310), frame)


def observation(frame, bbox=(100, 250, 500, 310), confidence=0.90):
    return TextObservation(frame, confidence, bbox, [])


class FakeOcrResult:
    def __init__(self, boxes=None, txts=None, scores=None):
        self.boxes = boxes
        self.txts = txts
        self.scores = scores


class FakeOcr:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, path, **kwargs):
        self.calls.append((path, kwargs))
        return self.result


class TemporalSubtitleTests(unittest.TestCase):
    def test_detection_only_uses_public_rapidocr_flags_and_region(self):
        inside = [[100, 250], [300, 250], [300, 300], [100, 300]]
        outside = [[100, 20], [300, 20], [300, 60], [100, 60]]
        ocr = FakeOcr(FakeOcrResult(
            boxes=[inside, outside],
            scores=[0.91, 0.99],
        ))
        result = detect_frame_observation(
            ocr, "frame.jpg", 7, (200, 400, 50, 500)
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.frame_index, 7)
        self.assertEqual(result.bbox, (100.0, 250.0, 300.0, 300.0))
        self.assertEqual(len(result.boxes), 1)
        self.assertEqual(
            ocr.calls[0][1],
            {
                "use_det": True,
                "use_cls": False,
                "use_rec": False,
                "box_thresh": 0.35,
            },
        )

    def test_recognition_is_restored_after_detection_only_call(self):
        box = [[100, 250], [300, 250], [300, 300], [100, 300]]
        ocr = FakeOcr(FakeOcrResult(
            boxes=[box],
            txts=["Noi dung"],
            scores=[0.92],
        ))
        result = ocr_frame_candidate(
            ocr, "frame.jpg", 4, 4, 4, 6, (0, 1000, 0, 1000)
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "Noi dung")
        self.assertAlmostEqual(result.end - result.start, 0.25)
        self.assertEqual(
            ocr.calls[0][1],
            {
                "use_det": True,
                "use_cls": True,
                "use_rec": True,
                "text_score": 0.5,
                "box_thresh": 0.5,
            },
        )

    def test_detection_episode_starts_when_text_is_first_seen(self):
        observations = [None, None, observation(2), observation(3), None]
        zeros = [0.0] * len(observations)
        episodes = build_detection_episodes(
            observations, zeros, zeros, zeros, fps=6, frame_count=len(observations)
        )
        self.assertEqual(
            [(item.start_frame, item.end_frame) for item in episodes],
            [(2, 3)],
        )

    def test_detection_episode_bridges_one_missed_frame(self):
        observations = [
            None, observation(1), observation(2), None, observation(4), None,
        ]
        zeros = [0.0] * len(observations)
        episodes = build_detection_episodes(
            observations, zeros, zeros, zeros, fps=6, frame_count=len(observations)
        )
        self.assertEqual(len(episodes), 1)
        self.assertEqual((episodes[0].start_frame, episodes[0].end_frame), (1, 4))

    def test_detection_episode_keeps_stable_sides_of_transition(self):
        observations = [observation(i) for i in range(11)]
        added = [0.0] * len(observations)
        removed = [0.0] * len(observations)
        changes = [0.0] * len(observations)
        for frame in (4, 6):
            added[frame] = 0.35
            removed[frame] = 0.55
            changes[frame] = 0.64
        episodes = build_detection_episodes(
            observations, added, removed, changes, fps=6, frame_count=len(observations)
        )
        self.assertEqual(
            [(item.start_frame, item.end_frame) for item in episodes],
            [(0, 3), (6, 10)],
        )

    def test_long_detection_episode_is_capped_for_recognition_coverage(self):
        observations = [observation(i) for i in range(11)]
        zeros = [0.0] * len(observations)
        episodes = build_detection_episodes(
            observations, zeros, zeros, zeros, fps=2, frame_count=len(observations)
        )
        self.assertEqual(
            [(item.start_frame, item.end_frame) for item in episodes],
            [(0, 5), (6, 10)],
        )

    def test_detection_samples_always_include_first_and_last(self):
        observations = [observation(i) for i in range(2, 7)]
        episode = DetectionEpisode(2, 6, observations)
        rung = [0.0] * 8
        net = [1.0] * 8
        net[4] = 10.0
        self.assertEqual(detection_sample_indices(episode, rung, net), [2, 4, 6])

    def test_visual_reveal_additions_stay_in_one_episode(self):
        # Moi frame them chu nhung khong xoa chu cu.
        added = [0.0, 0.55, 0.42, 0.31, 0.05, 0.02]
        removed = [0.0, 0.00, 0.02, 0.01, 0.03, 0.01]
        changes = [0.0, 0.62, 0.51, 0.44, 0.08, 0.04]
        self.assertEqual(
            visual_episode_ranges(6, added, removed, changes, fps=4),
            [(0, 5)],
        )

    def test_replacement_animation_is_one_boundary(self):
        # Ba frame fade/slide sat nhau chi la mot lan thay subtitle.
        added = [0.0] * 16
        removed = [0.0] * 16
        changes = [0.0] * 16
        for frame, remove in ((7, 0.48), (9, 0.76), (10, 0.51)):
            added[frame] = 0.35
            removed[frame] = remove
            changes[frame] = 0.64
        self.assertEqual(
            visual_episode_ranges(16, added, removed, changes, fps=4),
            [(0, 9), (10, 15)],
        )

    def test_episode_votes_longest_terminal_reveal(self):
        cues = build_episode_cues([[
            candidate(8.25, 11.25, "trước", 180, frame_index=35),
            candidate(8.25, 11.25, "trước đây", 260, frame_index=39),
            candidate(8.25, 11.25, "trước đây tầm nhìn ra thế giới để tìm cầu", 620, frame_index=43),
        ]])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "trước đây tầm nhìn ra thế giới để tìm cầu")
        self.assertEqual((cues[0].start, cues[0].end), (8.25, 11.25))

    def test_low_confidence_terminal_garbage_loses_vote(self):
        cues = build_episode_cues([[
            candidate(16.75, 20.75, "bề", 180, 0.99, 70),
            candidate(16.75, 20.75, "bề ngoài đó trông", 430, 0.99, 74),
            candidate(16.75, 20.75, "be n g", 500, 0.70, 78),
        ]])
        self.assertEqual(cues[0].text, "bề ngoài đó trông")

    def test_word_reveal_becomes_one_complete_cue(self):
        cues = build_final_cues([
            candidate(0.00, 0.25, "Tôi", 180),
            candidate(0.25, 0.50, "Tôi đang", 260),
            candidate(0.50, 0.75, "Tôi đang làm", 360),
            candidate(0.75, 1.50, "Tôi đang làm video", 500),
        ])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Tôi đang làm video")
        self.assertEqual((cues[0].start, cues[0].end), (0.0, 1.5))

    def test_karaoke_color_changes_do_not_duplicate_text(self):
        cues = build_final_cues([
            candidate(0.0, 0.3, "Hôm nay trời đẹp"),
            candidate(0.3, 0.6, "Hôm nay trời đẹp"),
            candidate(0.6, 1.2, "Hôm nay trời đẹp"),
        ])
        self.assertEqual([cue.text for cue in cues], ["Hôm nay trời đẹp"])

    def test_real_neighboring_sentences_are_not_merged(self):
        cues = build_final_cues([
            candidate(0.0, 1.0, "Tôi thích cà phê"),
            candidate(1.0, 2.0, "Tôi thích trà"),
        ])
        self.assertEqual(len(cues), 2)

    def test_reordered_words_are_not_treated_as_same_cue(self):
        cues = build_final_cues([
            candidate(0.0, 0.8, "one two three"),
            candidate(0.8, 1.6, "three two one"),
        ])
        self.assertEqual(len(cues), 2)

    def test_blank_gap_protects_identical_neighboring_cues(self):
        cues = build_final_cues([
            candidate(0.0, 0.8, "Xin chào"),
            candidate(1.5, 2.2, "Xin chào"),
        ])
        self.assertEqual(len(cues), 2)

    def test_cjk_reveal_uses_character_sequence(self):
        cues = build_final_cues([
            candidate(0.0, 0.2, "今", 150),
            candidate(0.2, 0.3, "今天", 180),
            candidate(0.3, 0.6, "今天天气", 300),
            candidate(0.6, 1.2, "今天天气很好", 460),
        ])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "今天天气很好")

    def test_unicode_normalization_and_non_latin_scripts(self):
        self.assertEqual(normalize_text("  ＡＢＣ  "), "abc")
        self.assertGreater(text_similarity("สวัสดีครับ", "สวัสดีครับ"), 0.99)
        self.assertGreater(text_similarity("مرحبا بالعالم", "مرحبا بالعالم"), 0.99)

    def test_short_blip_is_removed(self):
        cues = build_final_cues([candidate(0.0, 0.1, "Rác")])
        self.assertEqual(cues, [])

    def test_one_frame_ocr_blip_does_not_split_stable_text(self):
        cues = build_final_cues([
            candidate(0.0, 0.3, "Nội dung ổn định"),
            candidate(0.3, 0.5, "Nộị dxng 8n định xyz", confidence=0.52),
            candidate(0.5, 1.0, "Nội dung ổn định"),
        ])
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Nội dung ổn định")

    def test_subsequence_with_ocr_noise_can_still_evolve(self):
        self.assertTrue(is_text_evolution("chào các bạn", "xin chào các bạn"))
        self.assertFalse(is_text_evolution("tôi thích cà phê", "tôi thích trà"))


if __name__ == "__main__":
    unittest.main()
