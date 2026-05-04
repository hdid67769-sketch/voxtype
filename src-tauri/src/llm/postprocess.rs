/// Post-processing utilities for LLM output.
///
/// This module provides the final safety net against LLM "format pollution" —
/// cases where the model echoes back input tags, adds "Output:" labels, or
/// includes reasoning content that should never reach the user.
///
/// All functions are zero-copy-friendly: if the input is already clean, the
/// original string is returned unchanged (via `Cow` semantics in future
/// revisions; currently a new `String` is returned for simplicity).

/// Remove common LLM format artifacts from a polished text string.
///
/// This is the last line of defence before text is typed into the target
/// application.  It handles:
///
/// 1. `[INPUT_TEXT]…[/INPUT_TEXT]` blocks (the entire block, inclusive)
/// 2. Residual `[INPUT_TEXT]` / `[/INPUT_TEXT]` tags left without a pair
/// 3. Common label prefixes on the very first non-empty line:
///    `Output:`, `Result:`, `Input:`, `润色结果：`, `润色：`, `答：`, `A:`
/// 4. Leading/trailing blank lines
///
/// Inputs that contain none of the above are returned as-is (a clone).
pub fn clean_llm_output(text: &str) -> String {
    // ── Step 1: strip [INPUT_TEXT]...[/INPUT_TEXT] blocks ─────────────────
    // We may have nested or malformed tags; iterate until stable.
    let mut result = text.to_string();

    // Remove complete [INPUT_TEXT]...[/INPUT_TEXT] blocks (greedy, handles
    // multi-line content inside the block).
    loop {
        let start = result.find("[INPUT_TEXT]");
        let end = result.find("[/INPUT_TEXT]");
        match (start, end) {
            (Some(s), Some(e)) if s <= e => {
                // Remove from [INPUT_TEXT] up to and including [/INPUT_TEXT]
                let end_tag = "[/INPUT_TEXT]";
                let remove_end = e + end_tag.len();
                // Also eat a single leading newline before the block and a
                // single trailing newline after, to avoid double blank lines.
                let remove_start = if s > 0 && result.as_bytes()[s - 1] == b'\n' {
                    s - 1
                } else {
                    s
                };
                let remove_end = if remove_end < result.len()
                    && result.as_bytes()[remove_end] == b'\n'
                {
                    remove_end + 1
                } else {
                    remove_end
                };
                result.drain(remove_start..remove_end);
            }
            _ => break,
        }
    }

    // ── Step 2: strip residual lone tags ──────────────────────────────────
    result = result.replace("[INPUT_TEXT]", "").replace("[/INPUT_TEXT]", "");

    // ── Step 3: strip label prefixes from the first non-empty line ─────────
    // Build the cleaned output line-by-line, removing a label only from the
    // very first content line (not every line, to avoid mangling list output).
    let label_prefixes: &[&str] = &[
        "Output:",
        "output:",
        "OUTPUT:",
        "Result:",
        "result:",
        "Input:",
        "input:",
        "润色结果：",
        "润色结果:",
        "润色：",
        "润色:",
        "答：",
        "答:",
        "A:",
        "A：",
    ];

    // Check if any label prefix needs stripping; if not, return as-is to
    // preserve the original newline structure (including \n\n paragraph breaks).
    let needs_label_strip = result.lines().find(|line| !line.trim().is_empty()).is_some_and(|first_line| {
        label_prefixes.iter().any(|prefix| first_line.trim_start().starts_with(prefix))
    });

    if !needs_label_strip {
        return result.trim().to_string();
    }

    // Only do line-level surgery when a label prefix was found.
    let mut lines: Vec<&str> = result.lines().collect();
    let mut first_content_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if !line.trim().is_empty() {
            first_content_idx = Some(i);
            break;
        }
    }

    if let Some(idx) = first_content_idx {
        let line = lines[idx];
        for prefix in label_prefixes {
            if line.trim_start().starts_with(prefix) {
                // Strip the prefix and any whitespace immediately after it
                let stripped = line
                    .trim_start()
                    .trim_start_matches(prefix)
                    .trim_start();
                lines[idx] = stripped;
                break;
            }
        }
    }

    // ── Step 4: reassemble and trim ───────────────────────────────────────
    // Use "\n\n" as join separator to preserve paragraph breaks that may have
    // been between lines. The original double-newline structure is more
    // important to keep than strict line-by-line reconstruction.
    let reassembled = lines.join("\n");
    reassembled.trim().to_string()
}

// ──────────────────────────────────────────────────────────────────────────
// Unit tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_input_is_unchanged() {
        let clean = "今天天气不错，我打算去公园散步。";
        assert_eq!(clean_llm_output(clean), clean);
    }

    #[test]
    fn removes_input_text_block() {
        let input = "[INPUT_TEXT]\n原始语音内容\n[/INPUT_TEXT]\n\n润色结果在这里";
        assert_eq!(clean_llm_output(input), "润色结果在这里");
    }

    #[test]
    fn removes_output_label_prefix() {
        let input = "Output: 今天天气不错，我打算去公园散步。";
        assert_eq!(
            clean_llm_output(input),
            "今天天气不错，我打算去公园散步。"
        );
    }

    #[test]
    fn removes_chinese_label_prefix() {
        let input = "润色结果：今天天气不错，我打算去公园散步。";
        assert_eq!(
            clean_llm_output(input),
            "今天天气不错，我打算去公园散步。"
        );
    }

    #[test]
    fn removes_full_pollution_pattern() {
        // The exact pattern that was observed in production
        let input = "[INPUT_TEXT]\n对下面这句话进行润色，没有出现差错，但是觉得不够精炼，你看在提示词哪一条上面需要进行加强？\n[/INPUT_TEXT]\n\nOutput: 对下列语句进行润色，虽无误但觉不够精炼，请查看提示词中哪一项需强化。";
        assert_eq!(
            clean_llm_output(input),
            "对下列语句进行润色，虽无误但觉不够精炼，请查看提示词中哪一项需强化。"
        );
    }

    #[test]
    fn handles_residual_lone_tags() {
        let input = "[INPUT_TEXT] 残余标签 [/INPUT_TEXT] 实际内容";
        assert_eq!(clean_llm_output(input), "实际内容");
    }

    #[test]
    fn preserves_multiline_list_output() {
        let input = "今天要做以下几件事：\n1. 开会\n2. 写报告\n3. 健身";
        assert_eq!(clean_llm_output(input), input);
    }

    #[test]
    fn strips_leading_trailing_blank_lines() {
        let input = "\n\n  实际内容  \n\n";
        assert_eq!(clean_llm_output(input), "实际内容");
    }

    #[test]
    fn output_prefix_case_variants() {
        assert_eq!(clean_llm_output("output: text"), "text");
        assert_eq!(clean_llm_output("OUTPUT: text"), "text");
        assert_eq!(clean_llm_output("Result: text"), "text");
    }

    #[test]
    fn does_not_strip_output_in_middle_of_text() {
        // "Output:" should only be stripped from the first content line
        let input = "这是第一行\nOutput: 这不应该被删除";
        assert_eq!(clean_llm_output(input), input);
    }
}
